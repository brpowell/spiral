//! Catalog store: the data-access surface the HTTP layer uses.
//!
//! [`CatalogStore`] is backend-neutral. [`SqliteStore`] is the only implementation today;
//! schema changes are versioned SQL files under `migrations/<backend>/`, embedded in the
//! binary and applied by [`CatalogStore::migrate`].

mod sqlite;

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::sync::Arc;

use anyhow::{bail, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};

use crate::models::{PackVersionRow, TakedownLogRow};

pub use sqlite::SqliteStore;

#[derive(Debug, thiserror::Error)]
pub enum InsertPackError {
    #[error("pack version already exists")]
    Duplicate,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[async_trait]
pub trait CatalogStore: Send + Sync {
    /// Apply any pending schema migrations. Safe to call repeatedly.
    async fn migrate(&self) -> Result<()>;

    /// Insert a published (or already-yanked) version row.
    async fn insert_pack_version(&self, row: &PackVersionRow) -> Result<(), InsertPackError>;

    /// All non-yanked versions, optionally filtered.
    async fn list_published_versions(
        &self,
        publisher_id: Option<&str>,
        contribution_type: Option<&str>,
    ) -> Result<Vec<PackVersionRow>>;

    /// Non-yanked versions of one pack, newest first.
    async fn list_published_versions_for_pack(
        &self,
        publisher_id: &str,
        pack_id: &str,
    ) -> Result<Vec<PackVersionRow>>;

    /// Published (non-yanked) version, or `None` if missing / yanked.
    async fn get_published_version(
        &self,
        publisher_id: &str,
        pack_id: &str,
        version: &str,
    ) -> Result<Option<PackVersionRow>>;

    /// Any stored version including yanked, used for download resolution.
    async fn get_version_for_download(
        &self,
        publisher_id: &str,
        pack_id: &str,
        version: &str,
    ) -> Result<Option<PackVersionRow>>;

    /// All versions, published and yanked, for the admin listing.
    async fn list_all_versions(&self) -> Result<Vec<PackVersionRow>>;

    /// Soft-delete. Returns `false` if the version does not exist or is already yanked.
    async fn yank_version(
        &self,
        publisher_id: &str,
        pack_id: &str,
        version: &str,
        yanked_at: DateTime<Utc>,
    ) -> Result<bool>;

    /// Clear `yanked_at`. Returns `false` if the version does not exist or is not yanked.
    async fn unyank_version(
        &self,
        publisher_id: &str,
        pack_id: &str,
        version: &str,
    ) -> Result<bool>;

    /// Delete one version row, returning it if it existed.
    async fn delete_version(
        &self,
        publisher_id: &str,
        pack_id: &str,
        version: &str,
    ) -> Result<Option<PackVersionRow>>;

    /// Delete every version of a pack, returning the deleted rows.
    async fn delete_pack_versions(
        &self,
        publisher_id: &str,
        pack_id: &str,
    ) -> Result<Vec<PackVersionRow>>;

    async fn insert_takedown_log(&self, row: &TakedownLogRow) -> Result<()>;

    /// True if this exact version (or a pack-level `*`) was purged.
    async fn was_purged(&self, publisher_id: &str, pack_id: &str, version: &str) -> Result<bool>;

    /// Highest-semver published version of a pack.
    async fn get_latest_published_version(
        &self,
        publisher_id: &str,
        pack_id: &str,
    ) -> Result<Option<PackVersionRow>> {
        let rows = self
            .list_published_versions_for_pack(publisher_id, pack_id)
            .await?;
        Ok(rows.into_iter().next())
    }
}

/// Open the catalog for `database_url` without applying migrations.
pub async fn open(database_url: &str) -> Result<Arc<dyn CatalogStore>> {
    if database_url.starts_with("sqlite:") {
        return Ok(Arc::new(SqliteStore::open(database_url).await?));
    }
    bail!("unsupported DATABASE_URL={database_url:?} (expected a sqlite:… URL)");
}

/// Open the catalog and apply pending migrations.
pub async fn connect(database_url: &str) -> Result<Arc<dyn CatalogStore>> {
    let store = open(database_url).await?;
    store.migrate().await?;
    Ok(store)
}

fn filter_by_contribution_type(
    rows: Vec<PackVersionRow>,
    contribution_type: Option<&str>,
) -> Vec<PackVersionRow> {
    let Some(wanted) = contribution_type else {
        return rows;
    };
    rows.into_iter()
        .filter(|row| row.contribution_types_vec().iter().any(|t| t == wanted))
        .collect()
}

fn sort_by_semver_desc(mut rows: Vec<PackVersionRow>) -> Vec<PackVersionRow> {
    rows.sort_by(|a, b| compare_version_desc(&a.version, &b.version));
    rows
}

fn compare_version_desc(a: &str, b: &str) -> Ordering {
    match (semver::Version::parse(a), semver::Version::parse(b)) {
        (Ok(va), Ok(vb)) => vb.cmp(&va),
        (Ok(_), Err(_)) => Ordering::Less,
        (Err(_), Ok(_)) => Ordering::Greater,
        (Err(_), Err(_)) => b.cmp(a),
    }
}

/// Collapse version rows into one summary per pack (highest semver wins).
pub fn group_packs_latest(rows: Vec<PackVersionRow>) -> Vec<(String, String, PackVersionRow)> {
    let mut best: BTreeMap<(String, String), PackVersionRow> = BTreeMap::new();
    for row in rows {
        let key = (row.publisher_id.clone(), row.pack_id.clone());
        match best.get(&key) {
            None => {
                best.insert(key, row);
            }
            Some(existing) => {
                if compare_version_desc(&row.version, &existing.version) == Ordering::Less {
                    best.insert(key, row);
                }
            }
        }
    }

    best.into_iter()
        .map(|((publisher_id, pack_id), row)| (publisher_id, pack_id, row))
        .collect()
}

/// Helper for tests / seed: build a row with JSON contribution_types.
#[allow(clippy::too_many_arguments)]
pub fn pack_version_row(
    publisher_id: &str,
    pack_id: &str,
    version: &str,
    contribution_types: &[&str],
    size_bytes: i64,
    sha256: &str,
    storage_key: &str,
    published_at: DateTime<Utc>,
    yanked_at: Option<DateTime<Utc>>,
) -> PackVersionRow {
    PackVersionRow {
        publisher_id: publisher_id.to_string(),
        pack_id: pack_id.to_string(),
        version: version.to_string(),
        min_app_version: None,
        contribution_types: serde_json::to_string(contribution_types).expect("json"),
        size_bytes,
        sha256: sha256.to_string(),
        storage_key: storage_key.to_string(),
        preview_storage_key: None,
        name: String::new(),
        description: String::new(),
        readme: None,
        changelog: None,
        contributions: "[]".to_string(),
        published_at,
        yanked_at,
    }
}
