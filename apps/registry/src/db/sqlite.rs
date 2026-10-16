//! SQLite implementation of [`CatalogStore`].

use std::str::FromStr;

use anyhow::{Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use super::{sort_by_semver_desc, CatalogStore, InsertItemError};
use crate::models::{ItemVersionRow, TakedownLogRow, ITEM_VERSION_COLUMNS};

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

    async fn insert_item_version(&self, row: &ItemVersionRow) -> Result<(), InsertItemError> {
        let result = sqlx::query(
            r#"
            INSERT INTO item_versions (
                publisher_id, item_type, item_id, version, name, description, min_app_version,
                size_bytes, sha256, storage_key, preview_storage_key, readme, changelog,
                published_at, yanked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&row.publisher_id)
        .bind(&row.item_type)
        .bind(&row.item_id)
        .bind(&row.version)
        .bind(&row.name)
        .bind(&row.description)
        .bind(&row.min_app_version)
        .bind(row.size_bytes)
        .bind(&row.sha256)
        .bind(&row.storage_key)
        .bind(&row.preview_storage_key)
        .bind(&row.readme)
        .bind(&row.changelog)
        .bind(row.published_at)
        .bind(row.yanked_at)
        .execute(&self.pool)
        .await;

        match result {
            Ok(_) => Ok(()),
            Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
                Err(InsertItemError::Duplicate)
            }
            Err(e) => Err(InsertItemError::Other(
                anyhow::Error::new(e).context("insert item_versions row"),
            )),
        }
    }

    async fn list_published_versions(
        &self,
        publisher_id: Option<&str>,
        item_type: Option<&str>,
    ) -> Result<Vec<ItemVersionRow>> {
        // `? IS NULL OR col = ?` keeps one statement for every filter combination.
        sqlx::query_as::<_, ItemVersionRow>(&format!(
            r#"
            SELECT {ITEM_VERSION_COLUMNS}
            FROM item_versions
            WHERE yanked_at IS NULL
              AND (? IS NULL OR publisher_id = ?)
              AND (? IS NULL OR item_type = ?)
            ORDER BY publisher_id, item_type, item_id, published_at DESC
            "#
        ))
        .bind(publisher_id)
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_type)
        .fetch_all(&self.pool)
        .await
        .context("list published item versions")
    }

    async fn list_published_versions_for_item(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
    ) -> Result<Vec<ItemVersionRow>> {
        let rows = sqlx::query_as::<_, ItemVersionRow>(&format!(
            r#"
            SELECT {ITEM_VERSION_COLUMNS}
            FROM item_versions
            WHERE yanked_at IS NULL AND publisher_id = ? AND item_type = ? AND item_id = ?
            "#
        ))
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .fetch_all(&self.pool)
        .await
        .context("list versions for item")?;

        Ok(sort_by_semver_desc(rows))
    }

    async fn get_published_version(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<Option<ItemVersionRow>> {
        sqlx::query_as::<_, ItemVersionRow>(&format!(
            r#"
            SELECT {ITEM_VERSION_COLUMNS}
            FROM item_versions
            WHERE publisher_id = ? AND item_type = ? AND item_id = ? AND version = ?
              AND yanked_at IS NULL
            "#
        ))
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .bind(version)
        .fetch_optional(&self.pool)
        .await
        .context("get published version")
    }

    async fn get_version_for_download(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<Option<ItemVersionRow>> {
        sqlx::query_as::<_, ItemVersionRow>(&format!(
            r#"
            SELECT {ITEM_VERSION_COLUMNS}
            FROM item_versions
            WHERE publisher_id = ? AND item_type = ? AND item_id = ? AND version = ?
            "#
        ))
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .bind(version)
        .fetch_optional(&self.pool)
        .await
        .context("get version for download")
    }

    async fn list_all_versions(&self) -> Result<Vec<ItemVersionRow>> {
        sqlx::query_as::<_, ItemVersionRow>(&format!(
            r#"
            SELECT {ITEM_VERSION_COLUMNS}
            FROM item_versions
            ORDER BY publisher_id, item_type, item_id, published_at DESC
            "#
        ))
        .fetch_all(&self.pool)
        .await
        .context("list all item versions")
    }

    async fn yank_version(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
        yanked_at: DateTime<Utc>,
    ) -> Result<bool> {
        let result = sqlx::query(
            r#"
            UPDATE item_versions
            SET yanked_at = ?
            WHERE publisher_id = ? AND item_type = ? AND item_id = ? AND version = ?
              AND yanked_at IS NULL
            "#,
        )
        .bind(yanked_at)
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .bind(version)
        .execute(&self.pool)
        .await
        .context("yank item version")?;
        Ok(result.rows_affected() > 0)
    }

    async fn unyank_version(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<bool> {
        let result = sqlx::query(
            r#"
            UPDATE item_versions
            SET yanked_at = NULL
            WHERE publisher_id = ? AND item_type = ? AND item_id = ? AND version = ?
              AND yanked_at IS NOT NULL
            "#,
        )
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .bind(version)
        .execute(&self.pool)
        .await
        .context("unyank item version")?;
        Ok(result.rows_affected() > 0)
    }

    async fn delete_version(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<Option<ItemVersionRow>> {
        let row = self
            .get_version_for_download(publisher_id, item_type, item_id, version)
            .await?;
        if row.is_none() {
            return Ok(None);
        }
        sqlx::query(
            r#"
            DELETE FROM item_versions
            WHERE publisher_id = ? AND item_type = ? AND item_id = ? AND version = ?
            "#,
        )
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .bind(version)
        .execute(&self.pool)
        .await
        .context("delete item version")?;
        Ok(row)
    }

    async fn delete_item_versions(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
    ) -> Result<Vec<ItemVersionRow>> {
        let rows = sqlx::query_as::<_, ItemVersionRow>(&format!(
            r#"
            SELECT {ITEM_VERSION_COLUMNS}
            FROM item_versions
            WHERE publisher_id = ? AND item_type = ? AND item_id = ?
            "#
        ))
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .fetch_all(&self.pool)
        .await
        .context("list item versions for purge")?;

        if rows.is_empty() {
            return Ok(rows);
        }

        sqlx::query(
            r#"
            DELETE FROM item_versions
            WHERE publisher_id = ? AND item_type = ? AND item_id = ?
            "#,
        )
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .execute(&self.pool)
        .await
        .context("delete item versions")?;

        Ok(rows)
    }

    async fn insert_takedown_log(&self, row: &TakedownLogRow) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO item_takedown_log (
                purged_at, publisher_id, item_type, item_id, version, reason, notice_ref
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(row.purged_at)
        .bind(&row.publisher_id)
        .bind(&row.item_type)
        .bind(&row.item_id)
        .bind(&row.version)
        .bind(&row.reason)
        .bind(&row.notice_ref)
        .execute(&self.pool)
        .await
        .context("insert item_takedown_log row")?;
        Ok(())
    }

    async fn was_purged(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<bool> {
        let count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*) FROM item_takedown_log
            WHERE publisher_id = ? AND item_type = ? AND item_id = ?
              AND (version = ? OR version = '*')
            "#,
        )
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .bind(version)
        .fetch_one(&self.pool)
        .await
        .context("query item_takedown_log")?;
        Ok(count > 0)
    }
}
