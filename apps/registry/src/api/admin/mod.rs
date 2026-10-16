//! Admin write API + Preact SPA (embedded from `admin/dist`).

mod panel;

use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;

use crate::api::auth::AdminAuth;
use crate::db::InsertPackError;
use crate::models::{
    AdminPackListResponse, PurgeRequest, PurgeResponse, TakedownLogRow, VersionDetailResponse,
};
use crate::publish::{validate_spk_bytes, PublishError};
use crate::AppState;

use super::{ApiError, ApiResult};

pub fn api_router(upload_body_limit: usize) -> Router<AppState> {
    let upload = Router::new()
        .route("/v1/rgad/packs", post(upload_pack))
        .layer(DefaultBodyLimit::max(upload_body_limit));

    Router::new()
        .route("/v1/rgad/packs", get(list_admin_packs))
        .merge(upload)
        .route(
            "/v1/rgad/packs/{publisher_id}/{pack_id}/versions/{version}/yank",
            post(yank_version),
        )
        .route(
            "/v1/rgad/packs/{publisher_id}/{pack_id}/versions/{version}/unyank",
            post(unyank_version),
        )
        .route(
            "/v1/rgad/packs/{publisher_id}/{pack_id}/versions/{version}/purge",
            post(purge_version),
        )
        .route(
            "/v1/rgad/packs/{publisher_id}/{pack_id}/purge",
            post(purge_pack),
        )
}

pub fn panel_router() -> Router<AppState> {
    Router::new()
        .route("/rgad", get(panel::index))
        .route("/rgad/", get(panel::index))
        .route("/rgad/{*path}", get(panel::static_file))
}

async fn list_admin_packs(
    _auth: AdminAuth,
    State(state): State<AppState>,
) -> ApiResult<Json<AdminPackListResponse>> {
    let rows = state.db.list_all_versions().await?;
    Ok(Json(AdminPackListResponse {
        versions: rows.iter().map(|r| r.to_admin_summary()).collect(),
    }))
}

async fn upload_pack(
    _auth: AdminAuth,
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> ApiResult<Json<VersionDetailResponse>> {
    let mut spk_bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart.next_field().await.map_err(map_multipart_error)? {
        let name = field.name().unwrap_or("").to_string();
        let data = read_field_limited(field, state.config.max_upload_bytes).await?;
        match name.as_str() {
            "spk" | "file" | "pack" => spk_bytes = Some(data),
            _ => {}
        }
    }

    let Some(bytes) = spk_bytes else {
        return Err(ApiError::bad_request(
            "missing_spk",
            "multipart field \"spk\" (the .spk archive) is required",
        ));
    };

    if bytes.len() as u64 > state.config.max_upload_bytes {
        return Err(ApiError::payload_too_large(format!(
            "upload exceeds MAX_UPLOAD_BYTES ({})",
            state.config.max_upload_bytes
        )));
    }

    let validated = validate_spk_bytes(&bytes).map_err(|e| match e {
        PublishError::Invalid(msg) => ApiError::bad_request("invalid_pack", msg),
    })?;

    state
        .storage
        .put(&validated.row.storage_key, &validated.bytes)
        .await
        .map_err(ApiError::from)?;

    if let (Some(preview_key), Some(preview_bytes)) = (
        validated.row.preview_storage_key.as_ref(),
        validated.preview.as_ref(),
    ) {
        state
            .storage
            .put(preview_key, preview_bytes)
            .await
            .map_err(ApiError::from)?;
    }

    match state.db.insert_pack_version(&validated.row).await {
        Ok(()) => Ok(Json(validated.row.to_detail())),
        Err(InsertPackError::Duplicate) => {
            let _ = state.storage.delete(&validated.row.storage_key).await;
            if let Some(preview_key) = &validated.row.preview_storage_key {
                let _ = state.storage.delete(preview_key).await;
            }
            Err(ApiError::conflict(format!(
                "pack version {}/{}@{} already exists",
                validated.row.publisher_id, validated.row.pack_id, validated.row.version
            )))
        }
        Err(InsertPackError::Other(e)) => Err(ApiError::from(e)),
    }
}

async fn read_field_limited(
    mut field: axum::extract::multipart::Field<'_>,
    max_bytes: u64,
) -> ApiResult<Vec<u8>> {
    let mut data = Vec::new();
    while let Some(chunk) = field.chunk().await.map_err(map_multipart_error)? {
        if (data.len() as u64).saturating_add(chunk.len() as u64) > max_bytes {
            return Err(ApiError::payload_too_large(format!(
                "upload exceeds MAX_UPLOAD_BYTES ({max_bytes})"
            )));
        }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}

fn map_multipart_error(err: axum::extract::multipart::MultipartError) -> ApiError {
    let msg = err.to_string();
    let lower = msg.to_ascii_lowercase();
    if lower.contains("length limit")
        || lower.contains("size limit")
        || lower.contains("too large")
        || lower.contains("body")
    {
        return ApiError::payload_too_large(msg);
    }
    ApiError::bad_request("invalid_multipart", msg)
}

async fn yank_version(
    _auth: AdminAuth,
    State(state): State<AppState>,
    Path((publisher_id, pack_id, version)): Path<(String, String, String)>,
) -> ApiResult<Json<serde_json::Value>> {
    let yanked = state
        .db
        .yank_version(&publisher_id, &pack_id, &version, Utc::now())
        .await?;
    if !yanked {
        // Distinguish missing vs already yanked.
        let exists = state
            .db
            .get_version_for_download(&publisher_id, &pack_id, &version)
            .await?
            .is_some();
        if exists {
            return Err(ApiError::conflict(format!(
                "version {publisher_id}/{pack_id}@{version} is already yanked"
            )));
        }
        return Err(ApiError::not_found(format!(
            "version {publisher_id}/{pack_id}@{version} not found"
        )));
    }
    Ok(Json(serde_json::json!({
        "publisherId": publisher_id,
        "packId": pack_id,
        "version": version,
        "yanked": true,
    })))
}

async fn unyank_version(
    _auth: AdminAuth,
    State(state): State<AppState>,
    Path((publisher_id, pack_id, version)): Path<(String, String, String)>,
) -> ApiResult<Json<serde_json::Value>> {
    let unyanked = state
        .db
        .unyank_version(&publisher_id, &pack_id, &version)
        .await?;
    if !unyanked {
        let exists = state
            .db
            .get_version_for_download(&publisher_id, &pack_id, &version)
            .await?
            .is_some();
        if exists {
            return Err(ApiError::conflict(format!(
                "version {publisher_id}/{pack_id}@{version} is not yanked"
            )));
        }
        return Err(ApiError::not_found(format!(
            "version {publisher_id}/{pack_id}@{version} not found"
        )));
    }
    Ok(Json(serde_json::json!({
        "publisherId": publisher_id,
        "packId": pack_id,
        "version": version,
        "yanked": false,
    })))
}

async fn purge_version(
    _auth: AdminAuth,
    State(state): State<AppState>,
    Path((publisher_id, pack_id, version)): Path<(String, String, String)>,
    Json(body): Json<PurgeRequest>,
) -> ApiResult<Json<PurgeResponse>> {
    let expected = format!("{publisher_id}/{pack_id}@{version}");
    validate_purge_confirm(&body, &expected)?;

    let Some(row) = state
        .db
        .delete_version(&publisher_id, &pack_id, &version)
        .await?
    else {
        return Err(ApiError::not_found(format!(
            "version {publisher_id}/{pack_id}@{version} not found"
        )));
    };

    state
        .storage
        .delete(&row.storage_key)
        .await
        .map_err(ApiError::from)?;
    if let Some(preview_key) = &row.preview_storage_key {
        let _ = state.storage.delete(preview_key).await;
    }

    state
        .db
        .insert_takedown_log(&TakedownLogRow {
            id: 0,
            purged_at: Utc::now(),
            publisher_id: publisher_id.clone(),
            pack_id: pack_id.clone(),
            version: version.clone(),
            reason: body.reason.trim().to_string(),
            notice_ref: body.notice_ref.filter(|s| !s.trim().is_empty()),
        })
        .await?;

    Ok(Json(PurgeResponse {
        purged: vec![expected],
    }))
}

async fn purge_pack(
    _auth: AdminAuth,
    State(state): State<AppState>,
    Path((publisher_id, pack_id)): Path<(String, String)>,
    Json(body): Json<PurgeRequest>,
) -> ApiResult<Json<PurgeResponse>> {
    let expected = format!("{publisher_id}/{pack_id}");
    validate_purge_confirm(&body, &expected)?;

    let rows = state
        .db
        .delete_pack_versions(&publisher_id, &pack_id)
        .await?;
    if rows.is_empty() {
        return Err(ApiError::not_found(format!(
            "pack {publisher_id}/{pack_id} not found"
        )));
    }

    let mut purged = Vec::new();
    for row in &rows {
        let _ = state.storage.delete(&row.storage_key).await;
        if let Some(preview_key) = &row.preview_storage_key {
            let _ = state.storage.delete(preview_key).await;
        }
        purged.push(format!(
            "{}/{}/{}",
            row.publisher_id, row.pack_id, row.version
        ));
    }

    state
        .db
        .insert_takedown_log(&TakedownLogRow {
            id: 0,
            purged_at: Utc::now(),
            publisher_id: publisher_id.clone(),
            pack_id: pack_id.clone(),
            version: "*".to_string(),
            reason: body.reason.trim().to_string(),
            notice_ref: body.notice_ref.filter(|s| !s.trim().is_empty()),
        })
        .await?;

    Ok(Json(PurgeResponse { purged }))
}

fn validate_purge_confirm(body: &PurgeRequest, expected: &str) -> ApiResult<()> {
    if body.reason.trim().is_empty() {
        return Err(ApiError::bad_request(
            "missing_reason",
            "purge requires a non-empty reason",
        ));
    }
    if body.confirm.trim() != expected {
        return Err(ApiError::bad_request(
            "confirm_mismatch",
            format!("confirm must exactly equal \"{expected}\""),
        ));
    }
    Ok(())
}
