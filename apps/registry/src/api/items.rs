use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use spk_format::item_type_folder;
use tokio_util::io::ReaderStream;

use crate::db::{self, compare_version_desc};
use crate::models::{
    ItemDetailResponse, ItemIdentity, ItemListQuery, ItemListResponse, ItemUpdate, ItemVersionRow,
    UpdateCheckRequest, UpdateCheckResponse, VersionDetailResponse, DEFAULT_LIST_LIMIT,
    MAX_LIST_LIMIT, MAX_UPDATE_CHECK_ITEMS,
};
use crate::preview::content_type_for_preview_key;
use crate::storage::DownloadTarget;
use crate::AppState;

use super::{ApiError, ApiResult};

pub fn catalog_router() -> Router<AppState> {
    Router::new()
        .route("/v1/items", get(list_items))
        .route("/v1/items/updates", post(check_updates))
        .route(
            "/v1/items/{publisher_id}/{item_type}/{item_id}",
            get(item_detail),
        )
        .route(
            "/v1/items/{publisher_id}/{item_type}/{item_id}/versions/{version}",
            get(version_detail),
        )
}

/// The preview image route. The admin panel's thumbnails point at it, so the private admin
/// listener serves it too; it exposes nothing the public listener does not.
pub fn preview_router() -> Router<AppState> {
    Router::new().route(
        "/v1/items/{publisher_id}/{item_type}/{item_id}/versions/{version}/preview",
        get(download_preview),
    )
}

pub fn download_router() -> Router<AppState> {
    Router::new().route(
        "/v1/items/{publisher_id}/{item_type}/{item_id}/versions/{version}/download",
        get(download_version),
    )
}

/// 404 for an item type the registry does not know, so typos never reach the database.
fn require_item_type(item_type: &str) -> ApiResult<()> {
    if item_type_folder(item_type).is_none() {
        return Err(ApiError::not_found(format!(
            "unknown item type \"{item_type}\""
        )));
    }
    Ok(())
}

async fn list_items(
    State(state): State<AppState>,
    Query(query): Query<ItemListQuery>,
) -> ApiResult<Json<ItemListResponse>> {
    if let Some(item_type) = query.item_type.as_deref() {
        if item_type_folder(item_type).is_none() {
            return Err(ApiError::bad_request(
                "invalid_type",
                format!("unknown item type \"{item_type}\""),
            ));
        }
    }
    let limit = query
        .limit
        .unwrap_or(DEFAULT_LIST_LIMIT)
        .clamp(1, MAX_LIST_LIMIT);
    let offset = query.offset.unwrap_or(0);

    let rows = state
        .db
        .list_published_versions(query.publisher.as_deref(), query.item_type.as_deref())
        .await?;

    let needle = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(str::to_lowercase);
    let mut latest: Vec<ItemVersionRow> = db::group_items_latest(rows)
        .into_iter()
        .filter(|row| {
            needle.as_deref().is_none_or(|needle| {
                [&row.name, &row.description, &row.item_id, &row.publisher_id]
                    .iter()
                    .any(|field| field.to_lowercase().contains(needle))
            })
        })
        .collect();
    latest.sort_by_cached_key(|row| (row.name.to_lowercase(), row.effective_id()));

    let total = latest.len();
    let items = latest
        .iter()
        .skip(offset)
        .take(limit)
        .map(ItemVersionRow::to_item_summary)
        .collect();

    Ok(Json(ItemListResponse {
        items,
        total,
        limit,
        offset,
    }))
}

async fn item_detail(
    State(state): State<AppState>,
    Path((publisher_id, item_type, item_id)): Path<(String, String, String)>,
) -> ApiResult<Json<ItemDetailResponse>> {
    require_item_type(&item_type)?;
    let versions = state
        .db
        .list_published_versions_for_item(&publisher_id, &item_type, &item_id)
        .await?;
    let Some(first) = versions.first() else {
        return Err(ApiError::not_found(format!(
            "item {publisher_id}/{item_type}/{item_id} not found"
        )));
    };

    Ok(Json(ItemDetailResponse {
        publisher_id: first.publisher_id.clone(),
        item_type: first.item_type.clone(),
        id: first.item_id.clone(),
        effective_id: first.effective_id(),
        versions: versions.iter().map(ItemVersionRow::to_summary).collect(),
    }))
}

async fn version_detail(
    State(state): State<AppState>,
    Path((publisher_id, item_type, item_id, version)): Path<(String, String, String, String)>,
) -> ApiResult<Json<VersionDetailResponse>> {
    require_item_type(&item_type)?;
    let row = if version == "latest" {
        state
            .db
            .get_latest_published_version(&publisher_id, &item_type, &item_id)
            .await?
    } else {
        state
            .db
            .get_published_version(&publisher_id, &item_type, &item_id, &version)
            .await?
    };

    let Some(row) = row else {
        return Err(ApiError::not_found(format!(
            "version {publisher_id}/{item_type}/{item_id}@{version} not found"
        )));
    };

    Ok(Json(row.to_detail()))
}

/// Resolve `latest` and load the stored row for a download or preview. Yanked versions stay
/// available by direct URL; purged versions answer 410.
async fn resolve_stored_version(
    state: &AppState,
    publisher_id: &str,
    item_type: &str,
    item_id: &str,
    version: &str,
) -> ApiResult<ItemVersionRow> {
    require_item_type(item_type)?;
    let resolved = if version == "latest" {
        state
            .db
            .get_latest_published_version(publisher_id, item_type, item_id)
            .await?
            .ok_or_else(|| {
                ApiError::not_found(format!(
                    "version {publisher_id}/{item_type}/{item_id}@latest not found"
                ))
            })?
            .version
    } else {
        version.to_string()
    };

    match state
        .db
        .get_version_for_download(publisher_id, item_type, item_id, &resolved)
        .await?
    {
        Some(row) => Ok(row),
        None => {
            let label = format!("{publisher_id}/{item_type}/{item_id}@{resolved}");
            if state
                .db
                .was_purged(publisher_id, item_type, item_id, &resolved)
                .await?
            {
                return Err(ApiError::gone(format!("version {label} was purged")));
            }
            Err(ApiError::not_found(format!("version {label} not found")))
        }
    }
}

async fn download_version(
    State(state): State<AppState>,
    Path((publisher_id, item_type, item_id, version)): Path<(String, String, String, String)>,
) -> ApiResult<Response> {
    let row = resolve_stored_version(&state, &publisher_id, &item_type, &item_id, &version).await?;

    let missing = format!(
        "artifact for {publisher_id}/{item_type}/{item_id}@{} missing",
        row.version
    );
    let target = state
        .storage
        .get_download_url(&row.storage_key)
        .await
        .map_err(|e| map_storage_lookup_error(e, &missing))?;

    // Count only downloads that resolve to a real artifact. A failed write must not fail the
    // download itself.
    if let Err(e) = state
        .db
        .record_download(&publisher_id, &item_type, &item_id, &row.version)
        .await
    {
        tracing::warn!(error = %e, "failed to record download");
    }

    match target {
        DownloadTarget::Redirect(url) => Ok(Redirect::temporary(&url).into_response()),
        DownloadTarget::LocalPath(path) => {
            let file = tokio::fs::File::open(&path)
                .await
                .map_err(|e| map_open_error(e, &path, &missing))?;
            let meta = tokio::fs::metadata(&path).await.ok();
            let body = Body::from_stream(ReaderStream::new(file));
            let filename = format!("{publisher_id}-{item_type}-{item_id}-{}.spk", row.version);
            let mut response = Response::new(body);
            *response.status_mut() = StatusCode::OK;
            let headers = response.headers_mut();
            headers.insert(header::CONTENT_TYPE, "application/zip".parse().unwrap());
            headers.insert(
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\"")
                    .parse()
                    .unwrap(),
            );
            if let Some(len) = meta.map(|m| m.len()) {
                headers.insert(header::CONTENT_LENGTH, len.to_string().parse().unwrap());
            }
            Ok(response)
        }
    }
}

/// Previews are always streamed by the registry, never redirected: the desktop client fetches
/// them with redirects disabled so that only the registry's own URL is contacted.
async fn download_preview(
    State(state): State<AppState>,
    Path((publisher_id, item_type, item_id, version)): Path<(String, String, String, String)>,
) -> ApiResult<Response> {
    let row = resolve_stored_version(&state, &publisher_id, &item_type, &item_id, &version).await?;

    let Some(preview_key) = row.preview_storage_key.as_deref() else {
        return Err(ApiError::not_found(format!(
            "item {publisher_id}/{item_type}/{item_id}@{} has no preview",
            row.version
        )));
    };

    let missing = format!(
        "preview for {publisher_id}/{item_type}/{item_id}@{} missing",
        row.version
    );
    let bytes = state
        .storage
        .get(preview_key)
        .await
        .map_err(|e| map_storage_lookup_error(e, &missing))?;

    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        content_type_for_preview_key(preview_key).parse().unwrap(),
    );
    headers.insert(
        header::CACHE_CONTROL,
        "public, max-age=86400".parse().unwrap(),
    );
    Ok(response)
}

/// `major.minor.patch` of a version, ignoring pre-release and build metadata, so a beta of the
/// app counts as the release it is heading to.
fn version_core(version: &semver::Version) -> (u64, u64, u64) {
    (version.major, version.minor, version.patch)
}

/// Whether `app` satisfies a version's optional `minAppVersion`.
fn meets_min_app_version(app: Option<&semver::Version>, min_app_version: Option<&str>) -> bool {
    let (Some(app), Some(min)) = (app, min_app_version) else {
        return true;
    };
    match semver::Version::parse(min) {
        Ok(min) => version_core(app) >= version_core(&min),
        // Publish validates this field; an unreadable one never blocks an update.
        Err(_) => true,
    }
}

async fn check_updates(
    State(state): State<AppState>,
    Json(request): Json<UpdateCheckRequest>,
) -> ApiResult<Json<UpdateCheckResponse>> {
    if request.items.len() > MAX_UPDATE_CHECK_ITEMS {
        return Err(ApiError::bad_request(
            "too_many_items",
            format!("at most {MAX_UPDATE_CHECK_ITEMS} items per update check"),
        ));
    }
    let app_version = match request.app_version.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(raw) => Some(semver::Version::parse(raw).map_err(|_| {
            ApiError::bad_request(
                "invalid_app_version",
                format!("appVersion must be semver, got {raw:?}"),
            )
        })?),
    };

    let mut updates = Vec::new();
    let mut unlisted = Vec::new();
    for installed in request.items {
        let versions = state
            .db
            .list_published_versions_for_item(
                &installed.publisher_id,
                &installed.item_type,
                &installed.id,
            )
            .await?;
        if versions.is_empty() {
            unlisted.push(ItemIdentity {
                publisher_id: installed.publisher_id,
                item_type: installed.item_type,
                id: installed.id,
            });
            continue;
        }

        // A version that is not semver cannot be compared, so it never produces an update.
        if semver::Version::parse(&installed.version).is_err() {
            continue;
        }
        let newest_compatible = versions.iter().find(|row| {
            meets_min_app_version(app_version.as_ref(), row.min_app_version.as_deref())
        });
        let Some(latest) = newest_compatible else {
            continue;
        };
        if compare_version_desc(&latest.version, &installed.version) == std::cmp::Ordering::Less {
            updates.push(ItemUpdate {
                publisher_id: installed.publisher_id,
                item_type: installed.item_type,
                id: installed.id,
                installed_version: installed.version,
                latest: latest.to_summary(),
            });
        }
    }

    Ok(Json(UpdateCheckResponse { updates, unlisted }))
}

/// DB row exists but blob is gone → 404 + warn (integrity drift). Other storage
/// failures → 500 via [`ApiError::internal`].
pub(super) fn map_storage_lookup_error(err: anyhow::Error, missing_message: &str) -> ApiError {
    if err
        .chain()
        .any(|cause| cause.to_string().starts_with("object not found:"))
    {
        tracing::warn!("storage object missing for published version: {err:#}");
        return ApiError::not_found(missing_message.to_string());
    }
    ApiError::internal(err)
}

fn map_open_error(err: std::io::Error, path: &std::path::Path, missing_message: &str) -> ApiError {
    if err.kind() == std::io::ErrorKind::NotFound {
        tracing::warn!(
            "storage file missing for published version: {}: {err}",
            path.display()
        );
        return ApiError::not_found(missing_message.to_string());
    }
    ApiError::internal(anyhow::anyhow!("open {}: {err}", path.display()))
}
