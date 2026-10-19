//! Admin write API + Preact SPA (embedded from `admin/dist`).

mod panel;

use axum::extract::{DefaultBodyLimit, Multipart, Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use spk_format::item_type_folder;

use crate::api::audit::Attempt;
use crate::api::auth::AdminAuth;
use crate::db::InsertItemError;
use crate::models::{
    audit_action, AdminItemListResponse, AuditListParams, AuditListResponse, AuditQuery,
    PurgeRequest, PurgeResponse, TakedownLogRow, VersionDetailResponse, DEFAULT_LIST_LIMIT,
    MAX_LIST_LIMIT,
};
use crate::publish::{validate_item_bytes, PublishError};
use crate::AppState;

use super::{ApiError, ApiResult};

/// Admin write API, mounted at `<admin_path>/api/items`.
pub fn api_router(upload_body_limit: usize, admin_path: &str) -> Router<AppState> {
    let base = format!("{admin_path}/api/items");
    let audit = format!("{admin_path}/api/audit");
    let item = format!("{base}/{{publisher_id}}/{{item_type}}/{{item_id}}");

    let upload = Router::new()
        .route(&base, post(upload_item))
        .layer(DefaultBodyLimit::max(upload_body_limit));

    Router::new()
        .route(&base, get(list_admin_items))
        .route(&audit, get(list_audit))
        .merge(upload)
        .route(
            &format!("{item}/versions/{{version}}/yank"),
            post(yank_version),
        )
        .route(
            &format!("{item}/versions/{{version}}/unyank"),
            post(unyank_version),
        )
        .route(
            &format!("{item}/versions/{{version}}/purge"),
            post(purge_version),
        )
        .route(&format!("{item}/purge"), post(purge_item))
}

/// The admin panel (single-page app), mounted at `admin_path`.
pub fn panel_router(admin_path: &str) -> Router<AppState> {
    Router::new()
        .route(admin_path, get(panel::index))
        .route(&format!("{admin_path}/"), get(panel::index))
        .route(&format!("{admin_path}/{{*path}}"), get(panel::static_file))
}

/// Unknown item types are a 404 before any lookup.
fn require_item_type(item_type: &str) -> ApiResult<()> {
    if item_type_folder(item_type).is_none() {
        return Err(ApiError::not_found(format!(
            "unknown item type \"{item_type}\""
        )));
    }
    Ok(())
}

async fn list_admin_items(
    _auth: AdminAuth,
    State(state): State<AppState>,
) -> ApiResult<Json<AdminItemListResponse>> {
    let rows = state.db.list_all_versions().await?;
    Ok(Json(AdminItemListResponse {
        versions: rows.iter().map(|r| r.to_admin_summary()).collect(),
    }))
}

/// The audit log, newest first. Reads are not themselves audited (only denied attempts are).
async fn list_audit(
    _auth: AdminAuth,
    State(state): State<AppState>,
    Query(params): Query<AuditListParams>,
) -> ApiResult<Json<AuditListResponse>> {
    let limit = params
        .limit
        .unwrap_or(DEFAULT_LIST_LIMIT)
        .clamp(1, MAX_LIST_LIMIT);
    let offset = params.offset.unwrap_or(0);
    let non_empty = |v: Option<String>| v.filter(|s| !s.is_empty());
    let (entries, total) = state
        .db
        .list_audit_entries(&AuditQuery {
            action: non_empty(params.action),
            publisher_id: non_empty(params.publisher),
            item_type: non_empty(params.item_type),
            item_id: non_empty(params.id),
            limit: limit as i64,
            offset: offset as i64,
        })
        .await?;
    Ok(Json(AuditListResponse {
        entries,
        total: total as usize,
        limit,
        offset,
    }))
}

async fn upload_item(
    auth: AdminAuth,
    State(state): State<AppState>,
    multipart: Multipart,
) -> ApiResult<Json<VersionDetailResponse>> {
    let mut attempt = Attempt::new(&auth, audit_action::UPLOAD);
    let result = upload_item_inner(&state, multipart, &mut attempt).await;
    attempt.finish(state.db.as_ref(), result.is_ok()).await;
    result
}

async fn upload_item_inner(
    state: &AppState,
    mut multipart: Multipart,
    attempt: &mut Attempt,
) -> ApiResult<Json<VersionDetailResponse>> {
    let mut spk_bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart.next_field().await.map_err(map_multipart_error)? {
        let name = field.name().unwrap_or("").to_string();
        let data = read_field_limited(field, state.config.max_upload_bytes).await?;
        if matches!(name.as_str(), "spk" | "file" | "item") {
            spk_bytes = Some(data);
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

    let validated = validate_item_bytes(&bytes).map_err(|e| match e {
        PublishError::Invalid(msg) => ApiError::bad_request("invalid_item", msg),
    })?;

    attempt.target(
        &validated.row.publisher_id,
        &validated.row.item_type,
        &validated.row.item_id,
    );
    attempt.version(&validated.row.version);

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

    match state.db.insert_item_version(&validated.row).await {
        Ok(()) => {
            attempt.log_success(state.db.as_ref()).await;
            Ok(Json(validated.row.to_detail()))
        }
        Err(InsertItemError::Duplicate) => {
            let _ = state.storage.delete(&validated.row.storage_key).await;
            if let Some(preview_key) = &validated.row.preview_storage_key {
                let _ = state.storage.delete(preview_key).await;
            }
            Err(ApiError::conflict(format!(
                "item version {}/{}/{}@{} already exists",
                validated.row.publisher_id,
                validated.row.item_type,
                validated.row.item_id,
                validated.row.version
            )))
        }
        Err(InsertItemError::Other(e)) => Err(ApiError::from(e)),
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

type VersionPath = Path<(String, String, String, String)>;

fn version_label(publisher_id: &str, item_type: &str, item_id: &str, version: &str) -> String {
    format!("{publisher_id}/{item_type}/{item_id}@{version}")
}

async fn yank_version(
    auth: AdminAuth,
    State(state): State<AppState>,
    Path((publisher_id, item_type, item_id, version)): VersionPath,
) -> ApiResult<Json<serde_json::Value>> {
    let mut attempt = Attempt::new(&auth, audit_action::YANK);
    attempt.target(&publisher_id, &item_type, &item_id);
    attempt.version(&version);
    let result = yank_version_inner(
        &state,
        publisher_id,
        item_type,
        item_id,
        version,
        &mut attempt,
    )
    .await;
    attempt.finish(state.db.as_ref(), result.is_ok()).await;
    result
}

async fn yank_version_inner(
    state: &AppState,
    publisher_id: String,
    item_type: String,
    item_id: String,
    version: String,
    attempt: &mut Attempt,
) -> ApiResult<Json<serde_json::Value>> {
    require_item_type(&item_type)?;
    let label = version_label(&publisher_id, &item_type, &item_id, &version);
    let yanked = state
        .db
        .yank_version(&publisher_id, &item_type, &item_id, &version, Utc::now())
        .await?;
    if !yanked {
        // Distinguish missing vs already yanked.
        let exists = state
            .db
            .get_version_for_download(&publisher_id, &item_type, &item_id, &version)
            .await?
            .is_some();
        if exists {
            return Err(ApiError::conflict(format!(
                "version {label} is already yanked"
            )));
        }
        return Err(ApiError::not_found(format!("version {label} not found")));
    }
    attempt.log_success(state.db.as_ref()).await;
    Ok(Json(serde_json::json!({
        "publisherId": publisher_id,
        "itemType": item_type,
        "id": item_id,
        "version": version,
        "yanked": true,
    })))
}

async fn unyank_version(
    auth: AdminAuth,
    State(state): State<AppState>,
    Path((publisher_id, item_type, item_id, version)): VersionPath,
) -> ApiResult<Json<serde_json::Value>> {
    let mut attempt = Attempt::new(&auth, audit_action::UNYANK);
    attempt.target(&publisher_id, &item_type, &item_id);
    attempt.version(&version);
    let result = unyank_version_inner(
        &state,
        publisher_id,
        item_type,
        item_id,
        version,
        &mut attempt,
    )
    .await;
    attempt.finish(state.db.as_ref(), result.is_ok()).await;
    result
}

async fn unyank_version_inner(
    state: &AppState,
    publisher_id: String,
    item_type: String,
    item_id: String,
    version: String,
    attempt: &mut Attempt,
) -> ApiResult<Json<serde_json::Value>> {
    require_item_type(&item_type)?;
    let label = version_label(&publisher_id, &item_type, &item_id, &version);
    let unyanked = state
        .db
        .unyank_version(&publisher_id, &item_type, &item_id, &version)
        .await?;
    if !unyanked {
        let exists = state
            .db
            .get_version_for_download(&publisher_id, &item_type, &item_id, &version)
            .await?
            .is_some();
        if exists {
            return Err(ApiError::conflict(format!("version {label} is not yanked")));
        }
        return Err(ApiError::not_found(format!("version {label} not found")));
    }
    attempt.log_success(state.db.as_ref()).await;
    Ok(Json(serde_json::json!({
        "publisherId": publisher_id,
        "itemType": item_type,
        "id": item_id,
        "version": version,
        "yanked": false,
    })))
}

async fn purge_version(
    auth: AdminAuth,
    State(state): State<AppState>,
    Path((publisher_id, item_type, item_id, version)): VersionPath,
    Json(body): Json<PurgeRequest>,
) -> ApiResult<Json<PurgeResponse>> {
    let mut attempt = Attempt::new(&auth, audit_action::PURGE_VERSION);
    attempt.target(&publisher_id, &item_type, &item_id);
    attempt.version(&version);
    attempt.reason(&body.reason);
    let result = purge_version_inner(
        &state,
        publisher_id,
        item_type,
        item_id,
        version,
        body,
        &mut attempt,
    )
    .await;
    attempt.finish(state.db.as_ref(), result.is_ok()).await;
    result
}

async fn purge_version_inner(
    state: &AppState,
    publisher_id: String,
    item_type: String,
    item_id: String,
    version: String,
    body: PurgeRequest,
    attempt: &mut Attempt,
) -> ApiResult<Json<PurgeResponse>> {
    require_item_type(&item_type)?;
    let expected = version_label(&publisher_id, &item_type, &item_id, &version);
    validate_purge_confirm(&body, &expected)?;

    let Some(row) = state
        .db
        .delete_version(
            &publisher_id,
            &item_type,
            &item_id,
            &version,
            Some(&attempt.success_entry()),
        )
        .await?
    else {
        return Err(ApiError::not_found(format!("version {expected} not found")));
    };
    attempt.mark_recorded();

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
            publisher_id,
            item_type,
            item_id,
            version,
            reason: body.reason.trim().to_string(),
            notice_ref: body.notice_ref.filter(|s| !s.trim().is_empty()),
        })
        .await?;

    Ok(Json(PurgeResponse {
        purged: vec![expected],
    }))
}

async fn purge_item(
    auth: AdminAuth,
    State(state): State<AppState>,
    Path((publisher_id, item_type, item_id)): Path<(String, String, String)>,
    Json(body): Json<PurgeRequest>,
) -> ApiResult<Json<PurgeResponse>> {
    let mut attempt = Attempt::new(&auth, audit_action::PURGE_ITEM);
    attempt.target(&publisher_id, &item_type, &item_id);
    attempt.reason(&body.reason);
    let result =
        purge_item_inner(&state, publisher_id, item_type, item_id, body, &mut attempt).await;
    attempt.finish(state.db.as_ref(), result.is_ok()).await;
    result
}

async fn purge_item_inner(
    state: &AppState,
    publisher_id: String,
    item_type: String,
    item_id: String,
    body: PurgeRequest,
    attempt: &mut Attempt,
) -> ApiResult<Json<PurgeResponse>> {
    require_item_type(&item_type)?;
    let expected = format!("{publisher_id}/{item_type}/{item_id}");
    validate_purge_confirm(&body, &expected)?;

    let rows = state
        .db
        .delete_item_versions(
            &publisher_id,
            &item_type,
            &item_id,
            Some(&attempt.success_entry()),
        )
        .await?;
    if rows.is_empty() {
        return Err(ApiError::not_found(format!("item {expected} not found")));
    }
    attempt.mark_recorded();

    let mut purged = Vec::new();
    for row in &rows {
        let _ = state.storage.delete(&row.storage_key).await;
        if let Some(preview_key) = &row.preview_storage_key {
            let _ = state.storage.delete(preview_key).await;
        }
        purged.push(format!("{expected}/{}", row.version));
    }

    state
        .db
        .insert_takedown_log(&TakedownLogRow {
            id: 0,
            purged_at: Utc::now(),
            publisher_id,
            item_type,
            item_id,
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
