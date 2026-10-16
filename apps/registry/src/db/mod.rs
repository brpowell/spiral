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

use crate::models::{ItemVersionRow, TakedownLogRow};

pub use sqlite::SqliteStore;

#[derive(Debug, thiserror::Error)]
pub enum InsertItemError {
    #[error("item version already exists")]
    Duplicate,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[async_trait]
pub trait CatalogStore: Send + Sync {
    /// Apply any pending schema migrations. Safe to call repeatedly.
    async fn migrate(&self) -> Result<()>;

    /// Insert a published (or already-yanked) version row.
    async fn insert_item_version(&self, row: &ItemVersionRow) -> Result<(), InsertItemError>;

    /// All non-yanked versions, optionally filtered by publisher and item type.
    async fn list_published_versions(
        &self,
        publisher_id: Option<&str>,
        item_type: Option<&str>,
    ) -> Result<Vec<ItemVersionRow>>;

    /// Non-yanked versions of one item, newest first.
    async fn list_published_versions_for_item(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
    ) -> Result<Vec<ItemVersionRow>>;

    /// Published (non-yanked) version, or `None` if missing / yanked.
    async fn get_published_version(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<Option<ItemVersionRow>>;

    /// Any stored version including yanked, used for download resolution.
    async fn get_version_for_download(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<Option<ItemVersionRow>>;

    /// All versions, published and yanked, for the admin listing.
    async fn list_all_versions(&self) -> Result<Vec<ItemVersionRow>>;

    /// Soft-delete. Returns `false` if the version does not exist or is already yanked.
    async fn yank_version(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
        yanked_at: DateTime<Utc>,
    ) -> Result<bool>;

    /// Clear `yanked_at`. Returns `false` if the version does not exist or is not yanked.
    async fn unyank_version(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<bool>;

    /// Delete one version row, returning it if it existed.
    async fn delete_version(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<Option<ItemVersionRow>>;

    /// Delete every version of an item, returning the deleted rows.
    async fn delete_item_versions(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
    ) -> Result<Vec<ItemVersionRow>>;

    async fn insert_takedown_log(&self, row: &TakedownLogRow) -> Result<()>;

    /// True if this exact version (or an item-level `*`) was purged.
    async fn was_purged(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<bool>;

    /// Highest-semver published version of an item.
    async fn get_latest_published_version(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
    ) -> Result<Option<ItemVersionRow>> {
        let rows = self
            .list_published_versions_for_item(publisher_id, item_type, item_id)
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

fn sort_by_semver_desc(mut rows: Vec<ItemVersionRow>) -> Vec<ItemVersionRow> {
    rows.sort_by(|a, b| compare_version_desc(&a.version, &b.version));
    rows
}

/// Order versions newest first: valid semver ahead of anything else.
pub fn compare_version_desc(a: &str, b: &str) -> Ordering {
    match (semver::Version::parse(a), semver::Version::parse(b)) {
        (Ok(va), Ok(vb)) => vb.cmp(&va),
        (Ok(_), Err(_)) => Ordering::Less,
        (Err(_), Ok(_)) => Ordering::Greater,
        (Err(_), Err(_)) => b.cmp(a),
    }
}

/// Collapse version rows into one row per item (highest semver wins).
pub fn group_items_latest(rows: Vec<ItemVersionRow>) -> Vec<ItemVersionRow> {
    let mut best: BTreeMap<(String, String, String), ItemVersionRow> = BTreeMap::new();
    for row in rows {
        let key = (
            row.publisher_id.clone(),
            row.item_type.clone(),
            row.item_id.clone(),
        );
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
    best.into_values().collect()
}

/// Helper for tests: build a row with placeholder content.
#[allow(clippy::too_many_arguments)]
pub fn item_version_row(
    publisher_id: &str,
    item_type: &str,
    item_id: &str,
    version: &str,
    size_bytes: i64,
    sha256: &str,
    storage_key: &str,
    published_at: DateTime<Utc>,
    yanked_at: Option<DateTime<Utc>>,
) -> ItemVersionRow {
    ItemVersionRow {
        publisher_id: publisher_id.to_string(),
        item_type: item_type.to_string(),
        item_id: item_id.to_string(),
        version: version.to_string(),
        name: item_id.to_string(),
        description: String::new(),
        min_app_version: None,
        size_bytes,
        sha256: sha256.to_string(),
        storage_key: storage_key.to_string(),
        preview_storage_key: None,
        readme: None,
        changelog: None,
        published_at,
        yanked_at,
    }
}
