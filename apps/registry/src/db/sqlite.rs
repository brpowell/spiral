//! SQLite implementation of [`CatalogStore`].

use std::str::FromStr;

use anyhow::{Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use super::{filter_by_contribution_type, sort_by_semver_desc, CatalogStore, InsertPackError};
use crate::models::{PackVersionRow, TakedownLogRow, PACK_VERSION_COLUMNS};

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations/sqlite");

pub struct SqliteStore {
    pool: SqlitePool,
}

impl SqliteStore {
    pub async fn open(database_url: &str) -> Result<Self> {
        let options = SqliteConnectOptions::from_str(database_url)
            .with_context(|| format!("parse DATABASE_URL={database_url}"))?
            .create_if_missing(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await
            .with_context(|| format!("connect to {database_url}"))?;

        Ok(Self { pool })
    }

    /// Underlying pool, for tests that inspect the schema.
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

#[async_trait]
impl CatalogStore for SqliteStore {
    async fn migrate(&self) -> Result<()> {
        MIGRATOR
            .run(&self.pool)
            .await
            .context("apply sqlite migrations")
    }

    async fn insert_pack_version(&self, row: &PackVersionRow) -> Result<(), InsertPackError> {
        let result = sqlx::query(
            r#"
            INSERT INTO pack_versions (
                publisher_id, pack_id, version, min_app_version, contribution_types,
                size_bytes, sha256, storage_key, preview_storage_key,
                name, description, readme, changelog, contributions,
                published_at, yanked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&row.publisher_id)
        .bind(&row.pack_id)
        .bind(&row.version)
        .bind(&row.min_app_version)
        .bind(&row.contribution_types)
        .bind(row.size_bytes)
        .bind(&row.sha256)
        .bind(&row.storage_key)
        .bind(&row.preview_storage_key)
        .bind(&row.name)
        .bind(&row.description)
        .bind(&row.readme)
        .bind(&row.changelog)
        .bind(&row.contributions)
        .bind(row.published_at)
        .bind(row.yanked_at)
        .execute(&self.pool)
        .await;

        match result {
            Ok(_) => Ok(()),
            Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
                Err(InsertPackError::Duplicate)
            }
            Err(e) => Err(InsertPackError::Other(
                anyhow::Error::new(e).context("insert pack_versions row"),
            )),
        }
    }

    async fn list_published_versions(
        &self,
        publisher_id: Option<&str>,
        contribution_type: Option<&str>,
    ) -> Result<Vec<PackVersionRow>> {
        // contribution_types is JSON text; filter that field in Rust after fetch.
        let rows = if let Some(publisher) = publisher_id {
            sqlx::query_as::<_, PackVersionRow>(&format!(
                r#"
                SELECT {PACK_VERSION_COLUMNS}
                FROM pack_versions
                WHERE yanked_at IS NULL AND publisher_id = ?
                ORDER BY publisher_id, pack_id, published_at DESC
                "#
            ))
            .bind(publisher)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query_as::<_, PackVersionRow>(&format!(
                r#"
                SELECT {PACK_VERSION_COLUMNS}
                FROM pack_versions
                WHERE yanked_at IS NULL
                ORDER BY publisher_id, pack_id, published_at DESC
                "#
            ))
            .fetch_all(&self.pool)
            .await
        }
        .context("list published pack versions")?;

        Ok(filter_by_contribution_type(rows, contribution_type))
    }

    async fn list_published_versions_for_pack(
        &self,
        publisher_id: &str,
        pack_id: &str,
    ) -> Result<Vec<PackVersionRow>> {
        let rows = sqlx::query_as::<_, PackVersionRow>(&format!(
            r#"
            SELECT {PACK_VERSION_COLUMNS}
            FROM pack_versions
            WHERE yanked_at IS NULL AND publisher_id = ? AND pack_id = ?
            "#
        ))
        .bind(publisher_id)
        .bind(pack_id)
        .fetch_all(&self.pool)
        .await
        .context("list versions for pack")?;

        Ok(sort_by_semver_desc(rows))
    }

    async fn get_published_version(
        &self,
        publisher_id: &str,
        pack_id: &str,
        version: &str,
    ) -> Result<Option<PackVersionRow>> {
        sqlx::query_as::<_, PackVersionRow>(&format!(
            r#"
            SELECT {PACK_VERSION_COLUMNS}
            FROM pack_versions
            WHERE publisher_id = ? AND pack_id = ? AND version = ? AND yanked_at IS NULL
            "#
        ))
        .bind(publisher_id)
        .bind(pack_id)
        .bind(version)
        .fetch_optional(&self.pool)
        .await
        .context("get published version")
    }

    async fn get_version_for_download(
        &self,
        publisher_id: &str,
        pack_id: &str,
        version: &str,
    ) -> Result<Option<PackVersionRow>> {
        sqlx::query_as::<_, PackVersionRow>(&format!(
            r#"
            SELECT {PACK_VERSION_COLUMNS}
            FROM pack_versions
            WHERE publisher_id = ? AND pack_id = ? AND version = ?
            "#
        ))
        .bind(publisher_id)
        .bind(pack_id)
        .bind(version)
        .fetch_optional(&self.pool)
        .await
        .context("get version for download")
    }

    async fn list_all_versions(&self) -> Result<Vec<PackVersionRow>> {
        sqlx::query_as::<_, PackVersionRow>(&format!(
            r#"
            SELECT {PACK_VERSION_COLUMNS}
            FROM pack_versions
            ORDER BY publisher_id, pack_id, published_at DESC
            "#
        ))
        .fetch_all(&self.pool)
        .await
        .context("list all pack versions")
    }

    async fn yank_version(
        &self,
        publisher_id: &str,
        pack_id: &str,
        version: &str,
        yanked_at: DateTime<Utc>,
    ) -> Result<bool> {
        let result = sqlx::query(
            r#"
            UPDATE pack_versions
            SET yanked_at = ?
            WHERE publisher_id = ? AND pack_id = ? AND version = ? AND yanked_at IS NULL
            "#,
        )
        .bind(yanked_at)
        .bind(publisher_id)
        .bind(pack_id)
        .bind(version)
        .execute(&self.pool)
        .await
        .context("yank pack version")?;
        Ok(result.rows_affected() > 0)
    }

    async fn unyank_version(
        &self,
        publisher_id: &str,
        pack_id: &str,
        version: &str,
    ) -> Result<bool> {
        let result = sqlx::query(
            r#"
            UPDATE pack_versions
            SET yanked_at = NULL
            WHERE publisher_id = ? AND pack_id = ? AND version = ? AND yanked_at IS NOT NULL
            "#,
        )
        .bind(publisher_id)
        .bind(pack_id)
        .bind(version)
        .execute(&self.pool)
        .await
        .context("unyank pack version")?;
        Ok(result.rows_affected() > 0)
    }

    async fn delete_version(
        &self,
        publisher_id: &str,
        pack_id: &str,
        version: &str,
    ) -> Result<Option<PackVersionRow>> {
        let row = self
            .get_version_for_download(publisher_id, pack_id, version)
            .await?;
        if row.is_none() {
            return Ok(None);
        }
        sqlx::query(
            r#"
            DELETE FROM pack_versions
            WHERE publisher_id = ? AND pack_id = ? AND version = ?
            "#,
        )
        .bind(publisher_id)
        .bind(pack_id)
        .bind(version)
        .execute(&self.pool)
        .await
        .context("delete pack version")?;
        Ok(row)
    }

    async fn delete_pack_versions(
        &self,
        publisher_id: &str,
        pack_id: &str,
    ) -> Result<Vec<PackVersionRow>> {
        let rows = sqlx::query_as::<_, PackVersionRow>(&format!(
            r#"
            SELECT {PACK_VERSION_COLUMNS}
            FROM pack_versions
            WHERE publisher_id = ? AND pack_id = ?
            "#
        ))
        .bind(publisher_id)
        .bind(pack_id)
        .fetch_all(&self.pool)
        .await
        .context("list pack versions for purge")?;

        if rows.is_empty() {
            return Ok(rows);
        }

        sqlx::query(
            r#"
            DELETE FROM pack_versions
            WHERE publisher_id = ? AND pack_id = ?
            "#,
        )
        .bind(publisher_id)
        .bind(pack_id)
        .execute(&self.pool)
        .await
        .context("delete pack versions")?;

        Ok(rows)
    }

    async fn insert_takedown_log(&self, row: &TakedownLogRow) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO takedown_log (
                purged_at, publisher_id, pack_id, version, reason, notice_ref
            ) VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(row.purged_at)
        .bind(&row.publisher_id)
        .bind(&row.pack_id)
        .bind(&row.version)
        .bind(&row.reason)
        .bind(&row.notice_ref)
        .execute(&self.pool)
        .await
        .context("insert takedown_log row")?;
        Ok(())
    }

    async fn was_purged(&self, publisher_id: &str, pack_id: &str, version: &str) -> Result<bool> {
        let count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*) FROM takedown_log
            WHERE publisher_id = ? AND pack_id = ?
              AND (version = ? OR version = '*')
            "#,
        )
        .bind(publisher_id)
        .bind(pack_id)
        .bind(version)
        .fetch_one(&self.pool)
        .await
        .context("query takedown_log")?;
        Ok(count > 0)
    }
}
