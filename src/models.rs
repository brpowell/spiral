//! Catalog / version response models (JSON camelCase).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::icons::icon_url_path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaResponse {
    pub protocol_version: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackListResponse {
    pub packs: Vec<PackSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackSummary {
    pub author_id: String,
    pub pack_id: String,
    pub latest_version: VersionSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackDetailResponse {
    pub author_id: String,
    pub pack_id: String,
    pub versions: Vec<VersionSummary>,
}

/// Contribution summary extracted at publish time for catalog browsing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContributionSummary {
    #[serde(rename = "type")]
    pub r#type: String,
    pub local_id: String,
    pub effective_id: String,
    pub name: String,
    pub author: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionSummary {
    pub version: String,
    pub name: String,
    pub description: String,
    pub min_app_version: Option<String>,
    pub contribution_types: Vec<String>,
    pub contributions: Vec<ContributionSummary>,
    pub size_bytes: i64,
    pub sha256: String,
    pub published_at: DateTime<Utc>,
    /// Relative path to the pack icon, when the published archive declared one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionDetailResponse {
    pub author_id: String,
    pub pack_id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub min_app_version: Option<String>,
    pub contribution_types: Vec<String>,
    pub contributions: Vec<ContributionSummary>,
    pub size_bytes: i64,
    pub sha256: String,
    pub published_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
    /// Pack README.md contents extracted at publish (omitted when absent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readme: Option<String>,
}

/// Internal row from `pack_versions`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PackVersionRow {
    pub author_id: String,
    pub pack_id: String,
    pub version: String,
    pub min_app_version: Option<String>,
    pub contribution_types: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub storage_key: String,
    pub icon_storage_key: Option<String>,
    pub name: String,
    pub description: String,
    pub readme: Option<String>,
    pub contributions: String,
    pub published_at: DateTime<Utc>,
    pub yanked_at: Option<DateTime<Utc>>,
}

/// Append-only purge / takedown audit row.
#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakedownLogRow {
    pub id: i64,
    pub purged_at: DateTime<Utc>,
    pub author_id: String,
    pub pack_id: String,
    /// Specific semver, or `*` for a pack-level purge.
    pub version: String,
    pub reason: String,
    pub notice_ref: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackListQuery {
    pub contribution_type: Option<String>,
    pub author_id: Option<String>,
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
    pub author_id: String,
    pub pack_id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub min_app_version: Option<String>,
    pub contribution_types: Vec<String>,
    pub contributions: Vec<ContributionSummary>,
    pub size_bytes: i64,
    pub sha256: String,
    pub published_at: DateTime<Utc>,
    pub yanked_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminPackListResponse {
    pub versions: Vec<AdminVersionSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurgeResponse {
    pub purged: Vec<String>,
}

/// Columns selected for every `PackVersionRow` query.
pub const PACK_VERSION_COLUMNS: &str = r#"
    author_id, pack_id, version, min_app_version, contribution_types,
    size_bytes, sha256, storage_key, icon_storage_key,
    name, description, readme, contributions,
    published_at, yanked_at
"#;

impl PackVersionRow {
    pub fn contribution_types_vec(&self) -> Vec<String> {
        serde_json::from_str(&self.contribution_types).unwrap_or_default()
    }

    pub fn contributions_vec(&self) -> Vec<ContributionSummary> {
        serde_json::from_str(&self.contributions).unwrap_or_default()
    }

    pub fn icon_url(&self) -> Option<String> {
        self.icon_storage_key.as_ref().map(|_| {
            icon_url_path(&self.author_id, &self.pack_id, &self.version)
        })
    }

    pub fn to_summary(&self) -> VersionSummary {
        VersionSummary {
            version: self.version.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            min_app_version: self.min_app_version.clone(),
            contribution_types: self.contribution_types_vec(),
            contributions: self.contributions_vec(),
            size_bytes: self.size_bytes,
            sha256: self.sha256.clone(),
            published_at: self.published_at,
            icon_url: self.icon_url(),
        }
    }

    pub fn to_detail(&self) -> VersionDetailResponse {
        VersionDetailResponse {
            author_id: self.author_id.clone(),
            pack_id: self.pack_id.clone(),
            version: self.version.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            min_app_version: self.min_app_version.clone(),
            contribution_types: self.contribution_types_vec(),
            contributions: self.contributions_vec(),
            size_bytes: self.size_bytes,
            sha256: self.sha256.clone(),
            published_at: self.published_at,
            icon_url: self.icon_url(),
            readme: self.readme.clone(),
        }
    }

    pub fn to_admin_summary(&self) -> AdminVersionSummary {
        AdminVersionSummary {
            author_id: self.author_id.clone(),
            pack_id: self.pack_id.clone(),
            version: self.version.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            min_app_version: self.min_app_version.clone(),
            contribution_types: self.contribution_types_vec(),
            contributions: self.contributions_vec(),
            size_bytes: self.size_bytes,
            sha256: self.sha256.clone(),
            published_at: self.published_at,
            yanked_at: self.yanked_at,
            icon_url: self.icon_url(),
        }
    }
}
