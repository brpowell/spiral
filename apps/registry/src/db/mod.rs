//! Catalog store: the data-access surface the HTTP layer uses.
//!
//! [`CatalogStore`] is backend-neutral: [`SqliteStore`] (the default) and [`PostgresStore`],
//! picked by the scheme of `DATABASE_URL`. Schema changes are versioned SQL files under
//! `migrations/<backend>/`, embedded in the binary and applied by [`CatalogStore::migrate`].

mod postgres;
mod sqlite;

use std::cmp::Ordering;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};

use crate::models::{
    AuditEntry, AuditQuery, ItemListFilter, ItemSort, ItemVersionRow, TakedownLogRow,
    ITEM_SUMMARY_COLUMNS,
};

pub use postgres::PostgresStore;
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

    /// Fill the listing keys (`version_order`, `name_lower`, `description_lower`) of rows that
    /// lack them, returning how many were updated. Rows inserted by this version always have
    /// them; this covers rows from before the columns existed.
    async fn backfill_list_keys(&self) -> Result<u64>;

    /// One page of the public catalog: the newest non-yanked version of each item matching
    /// `filter`, in its order, with the total number of matching items. Rows leave out
    /// `readme` and `changelog`.
    async fn list_latest_items(
        &self,
        filter: &ItemListFilter,
    ) -> Result<(Vec<ItemVersionRow>, i64)>;

    /// Non-yanked versions of one item, newest first, without `readme` and `changelog`.
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

    /// Add one to a version's download count. Returns `false` if the version does not exist.
    async fn record_download(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<bool>;

    /// Recorded download count for a version, or `None` if it does not exist.
    async fn get_download_count(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<Option<i64>>;

    /// All versions, published and yanked, for the admin listing (without `readme` and
    /// `changelog`).
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
    ///
    /// When `audit` is given and a row was deleted, the entry is written in the same
    /// transaction: if the audit insert fails, the delete is rolled back and an error returned.
    async fn delete_version(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
        audit: Option<&AuditEntry>,
    ) -> Result<Option<ItemVersionRow>>;

    /// Delete every version of an item, returning the deleted rows. `audit` is written in the
    /// same transaction, as for [`CatalogStore::delete_version`].
    async fn delete_item_versions(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        audit: Option<&AuditEntry>,
    ) -> Result<Vec<ItemVersionRow>>;

    /// Append an entry to the audit log (`entry.id` is ignored).
    async fn insert_audit_entry(&self, entry: &AuditEntry) -> Result<()>;

    /// Audit entries matching the filters, newest first, with the total match count.
    async fn list_audit_entries(&self, query: &AuditQuery) -> Result<(Vec<AuditEntry>, i64)>;

    async fn insert_takedown_log(&self, row: &TakedownLogRow) -> Result<()>;

    /// True if this exact version (or an item-level `*`) was purged.
    async fn was_purged(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<bool>;

    /// Highest-semver published version of an item, with every column.
    async fn get_latest_published_version(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
    ) -> Result<Option<ItemVersionRow>> {
        let rows = self
            .list_published_versions_for_item(publisher_id, item_type, item_id)
            .await?;
        let Some(latest) = rows.into_iter().next() else {
            return Ok(None);
        };
        self.get_published_version(publisher_id, item_type, item_id, &latest.version)
            .await
    }
}

/// Connection settings for the networked backends (SQLite ignores them).
#[derive(Debug, Clone)]
pub struct DbOptions {
    /// Pool size. Serverless Postgres plans cap connections, so keep this small.
    pub max_connections: u32,
    /// How long a request waits for a connection; generous so a cold database can wake.
    pub acquire_timeout: Duration,
    /// The URL points at a transaction-mode connection pooler (disables prepared statements).
    pub pooler: bool,
}

impl Default for DbOptions {
    fn default() -> Self {
        Self {
            max_connections: 5,
            acquire_timeout: Duration::from_secs(30),
            pooler: false,
        }
    }
}

/// Whether a Postgres URL looks like a transaction pooler: Neon's `-pooler` hosts, Supabase's
/// pooler host or its port 6543. A hint only; `DB_POOLER` overrides it either way.
pub fn looks_pooled(database_url: &str) -> bool {
    let Some(rest) = database_url.split("://").nth(1) else {
        return false;
    };
    let authority = rest.split(['/', '?']).next().unwrap_or("");
    let host_port = authority.rsplit('@').next().unwrap_or("");
    let (host, port) = host_port.rsplit_once(':').unwrap_or((host_port, ""));
    host.contains("-pooler") || host.contains("pooler.supabase.com") || port == "6543"
}

/// Which backend a `DATABASE_URL` selects.
pub fn is_postgres_url(database_url: &str) -> bool {
    database_url.starts_with("postgres://") || database_url.starts_with("postgresql://")
}

/// Open the catalog for `database_url` without applying migrations.
pub async fn open_with(database_url: &str, options: &DbOptions) -> Result<Arc<dyn CatalogStore>> {
    if database_url.starts_with("sqlite:") {
        return Ok(Arc::new(SqliteStore::open(database_url).await?));
    }
    if is_postgres_url(database_url) {
        return Ok(Arc::new(PostgresStore::open(database_url, options).await?));
    }
    bail!("unsupported DATABASE_URL (expected a sqlite:… or postgres://… URL)");
}

/// [`open_with`] using default [`DbOptions`].
pub async fn open(database_url: &str) -> Result<Arc<dyn CatalogStore>> {
    open_with(database_url, &DbOptions::default()).await
}

/// Open the catalog with default options and apply pending migrations.
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

/// A text key whose byte order is the version order of [`compare_version_desc`] (ascending key,
/// older version), so the database can pick an item's newest version itself.
///
/// Valid semver is `1`, the zero-padded major, minor and patch, then the pre-release: `~` for a
/// release (above any pre-release), else its identifiers joined by `!`, each `0<len><digits>`
/// when numeric (numeric identifiers rank below alphanumeric ones) or `1<ident>`. Build metadata
/// follows after a space, as a tie-break only. `!` and the space sort below every character an
/// identifier can hold, so a shorter identifier list ranks first, as semver requires.
/// Anything else is `0` followed by the raw string, below every valid version.
pub fn version_order_key(version: &str) -> String {
    let Ok(parsed) = semver::Version::parse(version) else {
        return format!("0{version}");
    };
    let mut key = format!(
        "1{:020}{:020}{:020}",
        parsed.major, parsed.minor, parsed.patch
    );
    if parsed.pre.is_empty() {
        key.push('~');
    } else {
        for (i, ident) in parsed.pre.as_str().split('.').enumerate() {
            if i > 0 {
                key.push('!');
            }
            if !ident.is_empty() && ident.bytes().all(|b| b.is_ascii_digit()) {
                key.push_str(&format!("0{:04}{ident}", ident.len()));
            } else {
                key.push('1');
                key.push_str(ident);
            }
        }
    }
    if !parsed.build.is_empty() {
        key.push(' ');
        key.push_str(parsed.build.as_str());
    }
    key
}

/// The listing keys stored beside a row: `(version_order, name_lower, description_lower)`.
/// Lowercasing happens here rather than in SQL so search and name sorting treat non-ASCII text
/// the same on every backend.
pub fn list_keys(version: &str, name: &str, description: &str) -> (String, String, String) {
    (
        version_order_key(version),
        name.to_lowercase(),
        description.to_lowercase(),
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Dialect {
    Sqlite,
    Postgres,
}

/// The SQL for [`CatalogStore::list_latest_items`]: a count statement and a page statement that
/// share the text arguments in `args`. The page statement takes two more, `LIMIT` and `OFFSET`.
struct LatestItemsSql {
    count: String,
    page: String,
    args: Vec<String>,
}

fn latest_items_sql(filter: &ItemListFilter, dialect: Dialect) -> LatestItemsSql {
    let mut args: Vec<String> = Vec::new();
    let mut arg = |value: &str| {
        args.push(value.to_string());
        match dialect {
            Dialect::Sqlite => "?".to_string(),
            Dialect::Postgres => format!("${}", args.len()),
        }
    };
    // Postgres compares text by the database locale unless told otherwise; byte order matches
    // SQLite and Rust's `String` ordering.
    let collate = match dialect {
        Dialect::Sqlite => "",
        Dialect::Postgres => r#" COLLATE "C""#,
    };

    let mut version_filter = String::new();
    if let Some(publisher_id) = &filter.publisher_id {
        version_filter.push_str(&format!(" AND publisher_id = {}", arg(publisher_id)));
    }
    if !filter.item_types.is_empty() {
        let placeholders: Vec<String> = filter.item_types.iter().map(|t| arg(t)).collect();
        version_filter.push_str(&format!(" AND item_type IN ({})", placeholders.join(", ")));
    }

    let mut item_filter = String::new();
    if let Some(needle) = &filter.needle {
        let contains: Vec<String> = [
            "name_lower",
            "description_lower",
            "lower(item_id)",
            "lower(publisher_id)",
        ]
        .iter()
        .map(|column| {
            let p = arg(needle);
            match dialect {
                Dialect::Sqlite => format!("instr({column}, {p}) > 0"),
                Dialect::Postgres => format!("strpos({column}, {p}) > 0"),
            }
        })
        .collect();
        item_filter.push_str(&format!(" AND ({})", contains.join(" OR ")));
    }

    let ranked = format!(
        r#"
        WITH ranked AS (
            SELECT publisher_id, item_type, item_id, version, name, description, author,
                min_app_version, size_bytes, sha256, storage_key, preview_storage_key,
                published_at, yanked_at, name_lower, description_lower,
                ROW_NUMBER() OVER (
                    PARTITION BY publisher_id, item_type, item_id
                    ORDER BY version_order{collate} DESC
                ) AS version_rank
            FROM item_versions
            WHERE yanked_at IS NULL{version_filter}
        )
        "#
    );
    let name = format!("name_lower{collate}");
    let effective_id = format!("(publisher_id || '.' || item_type || '.' || item_id){collate}");
    let order_by = match filter.sort {
        ItemSort::Name => format!("{name} ASC, {effective_id} ASC"),
        ItemSort::NameDesc => format!("{name} DESC, {effective_id} DESC"),
        ItemSort::Newest => format!("published_at DESC, {name} ASC, {effective_id} ASC"),
        ItemSort::Oldest => format!("published_at ASC, {name} ASC, {effective_id} ASC"),
    };

    let count = format!("{ranked} SELECT COUNT(*) FROM ranked WHERE version_rank = 1{item_filter}");
    let (limit, offset) = match dialect {
        Dialect::Sqlite => ("?".to_string(), "?".to_string()),
        Dialect::Postgres => (
            format!("${}", args.len() + 1),
            format!("${}", args.len() + 2),
        ),
    };
    let page = format!(
        "{ranked} SELECT {ITEM_SUMMARY_COLUMNS} FROM ranked WHERE version_rank = 1{item_filter} \
         ORDER BY {order_by} LIMIT {limit} OFFSET {offset}"
    );
    LatestItemsSql { count, page, args }
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
        author: String::new(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_order_key_sorts_like_semver() {
        let versions = [
            "2.0.0",
            "1.10.0",
            "1.2.0",
            "1.0.0+build",
            "1.0.0",
            "1.0.0-rc.1",
            "1.0.0-beta.11",
            "1.0.0-beta.2",
            "1.0.0-beta",
            "1.0.0-alpha.beta",
            "1.0.0-alpha.1",
            "1.0.0-alpha",
            "1.0.0-a-b",
            "1.0.0-a.x",
            "1.0.0-a",
            "1.0.0-10",
            "1.0.0-9",
            "0.0.0",
            "not-semver",
            "01.0.0",
        ];
        let mut by_semver = versions.to_vec();
        by_semver.reverse();
        by_semver.sort_by(|a, b| compare_version_desc(a, b));
        let mut by_key = versions.to_vec();
        by_key.reverse();
        by_key.sort_by_key(|v| std::cmp::Reverse(version_order_key(v)));
        assert_eq!(by_key, by_semver);
        assert_eq!(by_semver, versions);
    }
}
