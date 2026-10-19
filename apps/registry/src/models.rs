//! Catalog / version response models (JSON camelCase).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use spk_format::effective_item_id;

use crate::preview::preview_url_path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaResponse {
    pub protocol_version: u32,
    pub name: String,
}

/// Default and maximum page sizes for `GET /v1/items`.
pub const DEFAULT_LIST_LIMIT: usize = 50;
pub const MAX_LIST_LIMIT: usize = 200;

/// Most installed items accepted by one `POST /v1/items/updates`.
pub const MAX_UPDATE_CHECK_ITEMS: usize = 200;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemListResponse {
    pub items: Vec<ItemSummary>,
    /// Matches before `limit` / `offset` are applied.
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSummary {
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
    pub effective_id: String,
    pub latest_version: VersionSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDetailResponse {
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
    pub effective_id: String,
    /// Non-yanked versions, newest first.
    pub versions: Vec<VersionSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionSummary {
    pub version: String,
    pub name: String,
    pub description: String,
    pub min_app_version: Option<String>,
    /// Uncompressed on-disk size of the item root (not `.spk` archive length).
    pub size_bytes: i64,
    pub sha256: String,
    pub published_at: DateTime<Utc>,
    /// Relative path to the item preview, when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionDetailResponse {
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
    pub effective_id: String,
    #[serde(flatten)]
    pub version: VersionSummary,
    /// README.md contents extracted at publish (omitted when absent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readme: Option<String>,
    /// CHANGELOG.md contents extracted at publish (omitted when absent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changelog: Option<String>,
}

/// Internal row from `item_versions`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ItemVersionRow {
    pub publisher_id: String,
    pub item_type: String,
    pub item_id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub min_app_version: Option<String>,
    /// Uncompressed on-disk size of the item root (not `.spk` archive length).
    pub size_bytes: i64,
    pub sha256: String,
    pub storage_key: String,
    pub preview_storage_key: Option<String>,
    pub readme: Option<String>,
    pub changelog: Option<String>,
    pub published_at: DateTime<Utc>,
    pub yanked_at: Option<DateTime<Utc>>,
}

/// Append-only purge / takedown audit row.
#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakedownLogRow {
    pub id: i64,
    pub purged_at: DateTime<Utc>,
    pub publisher_id: String,
    pub item_type: String,
    pub item_id: String,
    /// Specific semver, or `*` for an item-level purge.
    pub version: String,
    pub reason: String,
    pub notice_ref: Option<String>,
}

/// Who performed an admin action. A string so named tokens can be added later without a
/// schema change; today every authenticated request is the single master token.
pub const ACTOR_MASTER_TOKEN: &str = "master-token";

/// `audit_log.action` values.
pub mod audit_action {
    pub const UPLOAD: &str = "upload";
    pub const YANK: &str = "yank";
    pub const UNYANK: &str = "unyank";
    pub const PURGE_VERSION: &str = "purge_version";
    pub const PURGE_ITEM: &str = "purge_item";
    pub const LIST_ITEMS: &str = "list_items";
    pub const READ_AUDIT: &str = "read_audit";
    /// A request that matched no known admin action (only seen for denied attempts).
    pub const UNKNOWN: &str = "unknown";
}

/// `audit_log.outcome` values.
pub mod audit_outcome {
    /// The change was made.
    pub const SUCCESS: &str = "success";
    /// Bad or missing token.
    pub const DENIED: &str = "denied";
    /// Authenticated, but the action did not happen (not found, conflict, invalid input).
    pub const FAILED: &str = "failed";
}

/// One row of the append-only admin audit log. Never holds a token or any part of one.
#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    /// Assigned by the database; ignored on insert.
    pub id: i64,
    pub at: DateTime<Utc>,
    pub actor: String,
    pub action: String,
    pub outcome: String,
    pub publisher_id: Option<String>,
    pub item_type: Option<String>,
    pub item_id: Option<String>,
    pub version: Option<String>,
    /// The purge `reason`, when given.
    pub reason: Option<String>,
    pub client_ip: Option<String>,
}

/// Filters and paging for the audit log listing.
#[derive(Debug, Clone, Default)]
pub struct AuditQuery {
    pub action: Option<String>,
    pub publisher_id: Option<String>,
    pub item_type: Option<String>,
    pub item_id: Option<String>,
    pub limit: i64,
    pub offset: i64,
}

/// Query string of `GET <ADMIN_PATH>/api/audit`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditListParams {
    pub action: Option<String>,
    pub publisher: Option<String>,
    #[serde(rename = "type")]
    pub item_type: Option<String>,
    pub id: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditListResponse {
    /// Newest first.
    pub entries: Vec<AuditEntry>,
    /// Matches before `limit` / `offset` are applied.
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

/// Query string of `GET /v1/items`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemListQuery {
    #[serde(rename = "type")]
    pub item_type: Option<String>,
    /// Case-insensitive substring over name, description, id and publisher.
    pub q: Option<String>,
    pub publisher: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

/// Identity of an item, without a version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemIdentity {
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
}

/// One installed item in an update check.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledItem {
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
    pub version: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckRequest {
    /// Running app version. When set, only versions whose `minAppVersion` it satisfies count.
    #[serde(default)]
    pub app_version: Option<String>,
    pub items: Vec<InstalledItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemUpdate {
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
    pub installed_version: String,
    pub latest: VersionSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResponse {
    /// Installed items that have a newer compatible version.
    pub updates: Vec<ItemUpdate>,
    /// Items with no published versions in this registry (never listed, yanked or purged).
    pub unlisted: Vec<ItemIdentity>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurgeRequest {
    pub confirm: String,
    pub reason: String,
    #[serde(default)]
    pub notice_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminVersionSummary {
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
    pub effective_id: String,
    #[serde(flatten)]
    pub version: VersionSummary,
    pub yanked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminItemListResponse {
    pub versions: Vec<AdminVersionSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurgeResponse {
    pub purged: Vec<String>,
}

/// Columns selected for every `ItemVersionRow` query.
pub const ITEM_VERSION_COLUMNS: &str = r#"
    publisher_id, item_type, item_id, version, name, description, min_app_version,
    size_bytes, sha256, storage_key, preview_storage_key, readme, changelog,
    published_at, yanked_at
"#;

impl ItemVersionRow {
    pub fn effective_id(&self) -> String {
        effective_item_id(&self.publisher_id, &self.item_type, &self.item_id)
    }

    pub fn preview_url(&self) -> Option<String> {
        self.preview_storage_key.as_ref().map(|_| {
            preview_url_path(
                &self.publisher_id,
                &self.item_type,
                &self.item_id,
                &self.version,
            )
        })
    }

    pub fn to_summary(&self) -> VersionSummary {
        VersionSummary {
            version: self.version.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            min_app_version: self.min_app_version.clone(),
            size_bytes: self.size_bytes,
            sha256: self.sha256.clone(),
            published_at: self.published_at,
            preview_url: self.preview_url(),
        }
    }

    pub fn to_item_summary(&self) -> ItemSummary {
        ItemSummary {
            publisher_id: self.publisher_id.clone(),
            item_type: self.item_type.clone(),
            id: self.item_id.clone(),
            effective_id: self.effective_id(),
            latest_version: self.to_summary(),
        }
    }

    pub fn to_detail(&self) -> VersionDetailResponse {
        VersionDetailResponse {
            publisher_id: self.publisher_id.clone(),
            item_type: self.item_type.clone(),
            id: self.item_id.clone(),
            effective_id: self.effective_id(),
            version: self.to_summary(),
            readme: self.readme.clone(),
            changelog: self.changelog.clone(),
        }
    }

    pub fn to_admin_summary(&self) -> AdminVersionSummary {
        AdminVersionSummary {
            publisher_id: self.publisher_id.clone(),
            item_type: self.item_type.clone(),
            id: self.item_id.clone(),
            effective_id: self.effective_id(),
            version: self.to_summary(),
            yanked_at: self.yanked_at,
        }
    }
}
