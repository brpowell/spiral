//! The router and its handlers.

use crate::artwork;
use crate::auth::{require_auth, Authenticator};
use crate::library::{is_artwork_hash, ArtworkOriginal, HostLibrary, HostLibraryError};
use axum::body::Body;
use axum::extract::rejection::{PathRejection, QueryRejection};
use axum::extract::{Path as UrlPath, Query, Request, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, ETAG, IF_NONE_MATCH};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{middleware, Json, Router};
use serde::{Deserialize, Serialize};
use spiral_sync::{LibraryId, Rev, SyncCursor};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tower::ServiceExt;
use tower_http::services::ServeFile;

/// What the router serves from: the library, who may read it, and where it
/// may cache resized artwork.
#[derive(Clone)]
pub struct HostApi {
    pub library: Arc<dyn HostLibrary>,
    pub auth: Arc<dyn Authenticator>,
    /// Resized artwork is written here, one file per image and size, and
    /// reused. The host owns the folder: keep it out of the Spiral folder,
    /// in an app cache folder or the OS temp dir. It is created on first use.
    pub cache_dir: PathBuf,
}

impl HostApi {
    pub fn new(
        library: impl HostLibrary,
        auth: impl Authenticator,
        cache_dir: impl Into<PathBuf>,
    ) -> Self {
        HostApi {
            library: Arc::new(library),
            auth: Arc::new(auth),
            cache_dir: cache_dir.into(),
        }
    }
}

#[derive(Clone)]
struct AppState {
    library: Arc<dyn HostLibrary>,
    cache_dir: Arc<Path>,
}

/// The host API. Authentication wraps every route and the fallback, so an
/// unknown path answers 401 to a request without a valid token, not 404.
pub fn router(api: HostApi) -> Router {
    let v1 = Router::new()
        // Replication: a client mirrors the catalog from these.
        .route("/sync/state", get(sync_state))
        .route("/sync/snapshot", get(snapshot))
        .route("/sync/changes", get(changes))
        // Content any client fetches, addressed by track id or image hash.
        .route("/tracks/{id}/audio", get(track_audio))
        .route("/artwork/{hash}", get(artwork))
        .method_not_allowed_fallback(method_not_allowed);
    let state = AppState {
        library: api.library,
        cache_dir: api.cache_dir.into(),
    };
    Router::new()
        .nest("/v1", v1)
        .fallback(not_found)
        .with_state(state)
        .layer(middleware::from_fn_with_state(api.auth, require_auth))
}

async fn sync_state(State(state): State<AppState>) -> Result<Response, ApiError> {
    Ok(Json(state.library.host_state().await?).into_response())
}

async fn snapshot(State(state): State<AppState>) -> Result<Response, ApiError> {
    Ok(Json(state.library.snapshot().await?).into_response())
}

#[derive(Deserialize)]
struct ChangesQuery {
    library_id: String,
    since: u64,
}

async fn changes(
    State(state): State<AppState>,
    query: Result<Query<ChangesQuery>, QueryRejection>,
) -> Result<Response, ApiError> {
    let Query(query) = query.map_err(|e| ApiError::BadRequest(e.body_text()))?;
    if query.library_id.is_empty() {
        return Err(ApiError::BadRequest("library_id must not be empty".into()));
    }
    let cursor = SyncCursor {
        library_id: LibraryId::new(query.library_id),
        rev: Rev(query.since),
    };
    Ok(Json(state.library.changes(&cursor).await?).into_response())
}

/// A track's audio file as stored, with range requests. An unknown track, a
/// missing file and a file the library won't serve are the same 404, so the
/// answer says nothing about what is on disk.
async fn track_audio(
    State(state): State<AppState>,
    id: Result<UrlPath<String>, PathRejection>,
    request: Request,
) -> Result<Response, ApiError> {
    let UrlPath(id) = id.map_err(|_| ApiError::NotFound)?;
    let path = state
        .library
        .track_file(&id)
        .await?
        .ok_or(ApiError::NotFound)?;
    serve_file(path, request).await
}

/// Serves `path` with `ServeFile`: ranges (`206`, `Content-Range`, `If-Range`)
/// and conditional requests. A file that vanished since the lookup is our
/// JSON 404, and a read error our JSON 500.
async fn serve_file(path: PathBuf, request: Request) -> Result<Response, ApiError> {
    let Ok(response) = ServeFile::new(&path).oneshot(request).await;
    match response.status() {
        StatusCode::NOT_FOUND => Err(ApiError::NotFound),
        StatusCode::INTERNAL_SERVER_ERROR => Err(ApiError::Library(HostLibraryError::storage(
            format!("reading {} failed", path.display()),
        ))),
        _ => Ok(response.map(Body::new)),
    }
}

#[derive(Deserialize)]
struct ArtworkQuery {
    max: Option<String>,
}

/// Responses carry a bearer token's worth of access, so only the client may
/// cache them; the URL names content by hash, so they never change.
const ARTWORK_CACHE_CONTROL: &str = "private, max-age=31536000, immutable";

/// An image by content hash: the original, or with `?max=N` no larger than
/// the size N snaps up to (see [`artwork::snap_max`]). Never upscaled.
async fn artwork(
    State(state): State<AppState>,
    hash: Result<UrlPath<String>, PathRejection>,
    query: Result<Query<ArtworkQuery>, QueryRejection>,
    request: Request,
) -> Result<Response, ApiError> {
    let Query(query) = query.map_err(|e| ApiError::BadRequest(e.body_text()))?;
    let max = query
        .max
        .map(|max| artwork::snap_max(&max))
        .transpose()
        .map_err(|_| ApiError::BadRequest("max must be a positive integer".into()))?;
    let UrlPath(hash) = hash.map_err(|_| ApiError::NotFound)?;
    // A malformed hash names nothing, like an unknown one.
    if !is_artwork_hash(&hash) {
        return Err(ApiError::NotFound);
    }
    let original = state
        .library
        .artwork_original(&hash)
        .await?
        .ok_or(ApiError::NotFound)?;

    let size = match max {
        Some(max) => {
            let original = original.clone();
            let longer = blocking(move || Ok(artwork::longer_side(&original))).await?;
            // Unknown dimensions: the file isn't an image we can read, so
            // there is nothing to resize.
            longer.filter(|&longer| longer > max).map(|_| max)
        }
        None => None,
    };
    let etag = HeaderValue::try_from(match size {
        Some(size) => format!("\"{hash}-{size}\""),
        None => format!("\"{hash}-orig\""),
    })
    .expect("a hash and a number make a valid header");

    if if_none_match(request.headers(), &etag) {
        let mut response = StatusCode::NOT_MODIFIED.into_response();
        set_artwork_headers(response.headers_mut(), etag, None);
        return Ok(response);
    }

    let (path, mime) = match size {
        None => {
            let ArtworkOriginal { path, mime, .. } = original;
            (path, HeaderValue::try_from(mime).ok())
        }
        Some(size) => {
            let cache_dir = Arc::clone(&state.cache_dir);
            let resized = blocking(move || {
                artwork::resized(&cache_dir, &hash, &original.path, size)
                    .map_err(HostLibraryError::Storage)
            })
            .await?;
            (resized.path, Some(HeaderValue::from_static(resized.mime)))
        }
    };
    let mut response = serve_file(path, request).await?;
    set_artwork_headers(response.headers_mut(), etag, mime);
    Ok(response)
}

fn set_artwork_headers(headers: &mut HeaderMap, etag: HeaderValue, mime: Option<HeaderValue>) {
    headers.insert(ETAG, etag);
    headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static(ARTWORK_CACHE_CONTROL),
    );
    if let Some(mime) = mime {
        headers.insert(CONTENT_TYPE, mime);
    }
}

/// Whether `If-None-Match` lists `etag` (or is `*`). Weak tags compare
/// equal to strong ones, as RFC 9110 has it for `If-None-Match`.
fn if_none_match(headers: &HeaderMap, etag: &HeaderValue) -> bool {
    let etag = etag.as_bytes();
    headers
        .get_all(IF_NONE_MATCH)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .any(|tag| tag == "*" || tag.strip_prefix("W/").unwrap_or(tag).as_bytes() == etag)
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, HostLibraryError> + Send + 'static,
) -> Result<T, ApiError> {
    Ok(tokio::task::spawn_blocking(work)
        .await
        .map_err(HostLibraryError::storage)??)
}

async fn not_found() -> Response {
    ApiError::NotFound.into_response()
}

async fn method_not_allowed() -> Response {
    error_response(StatusCode::METHOD_NOT_ALLOWED, "method not allowed")
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    error: &'a str,
}

pub(crate) fn error_response(status: StatusCode, message: &str) -> Response {
    (status, Json(ErrorBody { error: message })).into_response()
}

enum ApiError {
    BadRequest(String),
    NotFound,
    Library(HostLibraryError),
}

impl From<HostLibraryError> for ApiError {
    fn from(e: HostLibraryError) -> Self {
        ApiError::Library(e)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            ApiError::BadRequest(message) => error_response(StatusCode::BAD_REQUEST, &message),
            ApiError::NotFound => error_response(StatusCode::NOT_FOUND, "not found"),
            ApiError::Library(HostLibraryError::Unsupported) => {
                error_response(StatusCode::NOT_IMPLEMENTED, "not implemented")
            }
            ApiError::Library(e) => {
                // Storage details stay in the host's log: they can name paths
                // and schema, which a client has no use for.
                tracing::error!(error = %e, "host library request failed");
                error_response(StatusCode::INTERNAL_SERVER_ERROR, "internal error")
            }
        }
    }
}
