//! The router and its handlers.

use crate::auth::{require_auth, Authenticator};
use crate::library::{HostLibrary, HostLibraryError};
use axum::extract::rejection::QueryRejection;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{middleware, Json, Router};
use serde::{Deserialize, Serialize};
use spiral_sync::{LibraryId, Rev, SyncCursor};
use std::sync::Arc;

/// What the router serves from: the library and who may read it.
#[derive(Clone)]
pub struct HostApi {
    pub library: Arc<dyn HostLibrary>,
    pub auth: Arc<dyn Authenticator>,
}

impl HostApi {
    pub fn new(library: impl HostLibrary, auth: impl Authenticator) -> Self {
        HostApi {
            library: Arc::new(library),
            auth: Arc::new(auth),
        }
    }
}

/// The host API. Authentication wraps every route and the fallback, so an
/// unknown path answers 401 to a request without a valid token, not 404.
pub fn router(api: HostApi) -> Router {
    let v1 = Router::new()
        .route("/library", get(library))
        .route("/snapshot", get(snapshot))
        .route("/changes", get(changes));
    Router::new()
        .nest("/v1", v1)
        .fallback(not_found)
        .with_state(Arc::clone(&api.library))
        .layer(middleware::from_fn_with_state(api.auth, require_auth))
}

type Library = State<Arc<dyn HostLibrary>>;

async fn library(State(library): Library) -> Result<Response, ApiError> {
    Ok(Json(library.host_state().await?).into_response())
}

async fn snapshot(State(library): Library) -> Result<Response, ApiError> {
    Ok(Json(library.snapshot().await?).into_response())
}

#[derive(Deserialize)]
struct ChangesQuery {
    library_id: String,
    since: u64,
}

async fn changes(
    State(library): Library,
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
    Ok(Json(library.changes(&cursor).await?).into_response())
}

async fn not_found() -> Response {
    error_response(StatusCode::NOT_FOUND, "not found")
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
            ApiError::Library(e) => {
                // Storage details stay in the host's log: they can name paths
                // and schema, which a client has no use for.
                tracing::error!(error = %e, "host library request failed");
                error_response(StatusCode::INTERNAL_SERVER_ERROR, "internal error")
            }
        }
    }
}
