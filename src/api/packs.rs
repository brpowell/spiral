use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::{Json, Router};
use tokio_util::io::ReaderStream;

use crate::db;
use crate::preview::content_type_for_preview_key;
use crate::models::{PackDetailResponse, PackListQuery, PackListResponse, PackSummary};
use crate::storage::DownloadTarget;
use crate::AppState;

use super::{ApiError, ApiResult};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/packs", get(list_packs))
        .route("/v1/packs/{author_id}/{pack_id}", get(pack_detail))
        .route(
            "/v1/packs/{author_id}/{pack_id}/versions/{version}",
            get(version_detail),
        )
        .route(
            "/v1/packs/{author_id}/{pack_id}/versions/{version}/download",
            get(download_version),
        )
        .route(
            "/v1/packs/{author_id}/{pack_id}/versions/{version}/preview",
            get(download_preview),
        )
}

async fn list_packs(
    State(state): State<AppState>,
    Query(query): Query<PackListQuery>,
) -> ApiResult<Json<PackListResponse>> {
    let rows = db::list_published_versions(
        &state.db,
        query.author_id.as_deref(),
        query.contribution_type.as_deref(),
    )
    .await?;

    let packs = db::group_packs_latest(rows)
        .into_iter()
        .map(|(author_id, pack_id, row)| PackSummary {
            author_id,
            pack_id,
            latest_version: row.to_summary(),
        })
        .collect();

    Ok(Json(PackListResponse { packs }))
}

async fn pack_detail(
    State(state): State<AppState>,
    Path((author_id, pack_id)): Path<(String, String)>,
) -> ApiResult<Json<PackDetailResponse>> {
    let versions = db::list_published_versions_for_pack(&state.db, &author_id, &pack_id).await?;
    if versions.is_empty() {
        return Err(ApiError::not_found(format!(
            "pack {author_id}/{pack_id} not found"
        )));
    }

    Ok(Json(PackDetailResponse {
        author_id,
        pack_id,
        versions: versions.iter().map(|v| v.to_summary()).collect(),
    }))
}

async fn version_detail(
    State(state): State<AppState>,
    Path((author_id, pack_id, version)): Path<(String, String, String)>,
) -> ApiResult<Json<crate::models::VersionDetailResponse>> {
    let row = if version == "latest" {
        db::get_latest_published_version(&state.db, &author_id, &pack_id).await?
    } else {
        db::get_published_version(&state.db, &author_id, &pack_id, &version).await?
    };

    let Some(row) = row else {
        return Err(ApiError::not_found(format!(
            "version {author_id}/{pack_id}@{version} not found"
        )));
    };

    Ok(Json(row.to_detail()))
}

async fn download_version(
    State(state): State<AppState>,
    Path((author_id, pack_id, version)): Path<(String, String, String)>,
) -> ApiResult<Response> {
    let resolved_version = if version == "latest" {
        let row = db::get_latest_published_version(&state.db, &author_id, &pack_id)
            .await?
            .ok_or_else(|| {
                ApiError::not_found(format!("version {author_id}/{pack_id}@latest not found"))
            })?;
        row.version
    } else {
        version
    };

    // Yanked versions remain downloadable by direct URL.
    // Purged versions are gone from pack_versions; consult takedown_log for 410.
    let row = match db::get_version_for_download(
        &state.db,
        &author_id,
        &pack_id,
        &resolved_version,
    )
    .await?
    {
        Some(row) => row,
        None => {
            if db::was_purged(&state.db, &author_id, &pack_id, &resolved_version).await? {
                return Err(ApiError::gone(format!(
                    "version {author_id}/{pack_id}@{resolved_version} was purged"
                )));
            }
            return Err(ApiError::not_found(format!(
                "version {author_id}/{pack_id}@{resolved_version} not found"
            )));
        }
    };

    let target = state
        .storage
        .get_download_url(&row.storage_key)
        .await
        .map_err(|e| {
            tracing::error!("storage get_download_url failed: {e:#}");
            ApiError::not_found(format!(
                "artifact for {author_id}/{pack_id}@{} missing",
                row.version
            ))
        })?;

    match target {
        DownloadTarget::Redirect(url) => Ok(Redirect::temporary(&url).into_response()),
        DownloadTarget::LocalPath(path) => {
            let file = tokio::fs::File::open(&path).await.map_err(|e| {
                tracing::error!("open {}: {e}", path.display());
                ApiError::not_found(format!(
                    "artifact for {author_id}/{pack_id}@{} missing",
                    row.version
                ))
            })?;
            let meta = tokio::fs::metadata(&path).await.ok();
            let stream = ReaderStream::new(file);
            let body = Body::from_stream(stream);
            let filename = format!("{author_id}-{pack_id}-{}.spk", row.version);
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

async fn download_preview(
    State(state): State<AppState>,
    Path((author_id, pack_id, version)): Path<(String, String, String)>,
) -> ApiResult<Response> {
    let resolved_version = if version == "latest" {
        let row = db::get_latest_published_version(&state.db, &author_id, &pack_id)
            .await?
            .ok_or_else(|| {
                ApiError::not_found(format!("version {author_id}/{pack_id}@latest not found"))
            })?;
        row.version
    } else {
        version
    };

    // Same availability as download: yanked still resolves; purged → 410.
    let row = match db::get_version_for_download(
        &state.db,
        &author_id,
        &pack_id,
        &resolved_version,
    )
    .await?
    {
        Some(row) => row,
        None => {
            if db::was_purged(&state.db, &author_id, &pack_id, &resolved_version).await? {
                return Err(ApiError::gone(format!(
                    "version {author_id}/{pack_id}@{resolved_version} was purged"
                )));
            }
            return Err(ApiError::not_found(format!(
                "version {author_id}/{pack_id}@{resolved_version} not found"
            )));
        }
    };

    let Some(preview_key) = row.preview_storage_key.as_deref() else {
        return Err(ApiError::not_found(format!(
            "pack {author_id}/{pack_id}@{} has no preview",
            row.version
        )));
    };

    let target = state
        .storage
        .get_download_url(preview_key)
        .await
        .map_err(|e| {
            tracing::error!("storage get_download_url for preview failed: {e:#}");
            ApiError::not_found(format!(
                "preview for {author_id}/{pack_id}@{} missing",
                row.version
            ))
        })?;

    match target {
        DownloadTarget::Redirect(url) => Ok(Redirect::temporary(&url).into_response()),
        DownloadTarget::LocalPath(path) => {
            let file = tokio::fs::File::open(&path).await.map_err(|e| {
                tracing::error!("open {}: {e}", path.display());
                ApiError::not_found(format!(
                    "preview for {author_id}/{pack_id}@{} missing",
                    row.version
                ))
            })?;
            let meta = tokio::fs::metadata(&path).await.ok();
            let stream = ReaderStream::new(file);
            let body = Body::from_stream(stream);
            let mut response = Response::new(body);
            *response.status_mut() = StatusCode::OK;
            let headers = response.headers_mut();
            headers.insert(
                header::CONTENT_TYPE,
                content_type_for_preview_key(preview_key).parse().unwrap(),
            );
            headers.insert(header::CACHE_CONTROL, "public, max-age=86400".parse().unwrap());
            if let Some(len) = meta.map(|m| m.len()) {
                headers.insert(header::CONTENT_LENGTH, len.to_string().parse().unwrap());
            }
            Ok(response)
        }
    }
}
