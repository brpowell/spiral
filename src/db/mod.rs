//! SQLite catalog store.

mod packs;

use anyhow::{Context, Result};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;

pub use packs::*;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS pack_versions (
    author_id TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    version TEXT NOT NULL,
    min_app_version TEXT,
    contribution_types TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    published_at TEXT NOT NULL,
    yanked_at TEXT,
    PRIMARY KEY (author_id, pack_id, version)
);

CREATE INDEX IF NOT EXISTS idx_pack_versions_author
    ON pack_versions (author_id);

CREATE INDEX IF NOT EXISTS idx_pack_versions_published
    ON pack_versions (author_id, pack_id, published_at);
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
        .context("apply pack_versions schema")?;

    Ok(pool)
}
