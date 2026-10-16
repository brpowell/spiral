//! SQLite catalog store.

mod packs;

use anyhow::{Context, Result};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;

pub use packs::*;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS pack_versions (
    publisher_id TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    version TEXT NOT NULL,
    min_app_version TEXT,
    contribution_types TEXT NOT NULL,
    -- Uncompressed on-disk size of the pack root (not .spk archive length).
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    preview_storage_key TEXT,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    readme TEXT,
    changelog TEXT,
    contributions TEXT NOT NULL DEFAULT '[]',
    published_at TEXT NOT NULL,
    yanked_at TEXT,
    PRIMARY KEY (publisher_id, pack_id, version)
);

CREATE INDEX IF NOT EXISTS idx_pack_versions_author
    ON pack_versions (publisher_id);

CREATE INDEX IF NOT EXISTS idx_pack_versions_published
    ON pack_versions (publisher_id, pack_id, published_at);

CREATE TABLE IF NOT EXISTS takedown_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purged_at TEXT NOT NULL,
    publisher_id TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    version TEXT NOT NULL,
    reason TEXT NOT NULL,
    notice_ref TEXT
);

CREATE INDEX IF NOT EXISTS idx_takedown_log_identity
    ON takedown_log (publisher_id, pack_id, version);
"#;

pub async fn connect(database_url: &str) -> Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(database_url)
        .with_context(|| format!("parse DATABASE_URL={database_url}"))?
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .with_context(|| format!("connect to {database_url}"))?;

    sqlx::query(SCHEMA)
        .execute(&pool)
        .await
        .context("apply pack_versions / takedown_log schema")?;

    // Upgrade DBs created before these columns existed.
    for stmt in [
        "ALTER TABLE pack_versions ADD COLUMN preview_storage_key TEXT",
        "ALTER TABLE pack_versions ADD COLUMN name TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE pack_versions ADD COLUMN description TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE pack_versions ADD COLUMN readme TEXT",
        "ALTER TABLE pack_versions ADD COLUMN changelog TEXT",
        "ALTER TABLE pack_versions ADD COLUMN contributions TEXT NOT NULL DEFAULT '[]'",
    ] {
        let _ = sqlx::query(stmt).execute(&pool).await;
    }

    Ok(pool)
}
