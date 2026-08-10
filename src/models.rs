//! Catalog / version response models (JSON camelCase).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionSummary {
    pub version: String,
    pub min_app_version: Option<String>,
    pub contribution_types: Vec<String>,
    pub size_bytes: i64,
    pub sha256: String,
    pub published_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionDetailResponse {
    pub author_id: String,
    pub pack_id: String,
    pub version: String,
    pub min_app_version: Option<String>,
    pub contribution_types: Vec<String>,
    pub size_bytes: i64,
    pub sha256: String,
    pub published_at: DateTime<Utc>,
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
    pub published_at: DateTime<Utc>,
    pub yanked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackListQuery {
    pub contribution_type: Option<String>,
    pub author_id: Option<String>,
}

impl PackVersionRow {
    pub fn contribution_types_vec(&self) -> Vec<String> {
        serde_json::from_str(&self.contribution_types).unwrap_or_default()
    }

    pub fn to_summary(&self) -> VersionSummary {
        VersionSummary {
            version: self.version.clone(),
            min_app_version: self.min_app_version.clone(),
            contribution_types: self.contribution_types_vec(),
            size_bytes: self.size_bytes,
            sha256: self.sha256.clone(),
            published_at: self.published_at,
        }
    }

    pub fn to_detail(&self) -> VersionDetailResponse {
        VersionDetailResponse {
            author_id: self.author_id.clone(),
            pack_id: self.pack_id.clone(),
            version: self.version.clone(),
            min_app_version: self.min_app_version.clone(),
            contribution_types: self.contribution_types_vec(),
            size_bytes: self.size_bytes,
            sha256: self.sha256.clone(),
            published_at: self.published_at,
        }
    }
}
