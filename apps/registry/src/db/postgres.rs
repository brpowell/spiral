//! Postgres implementation of [`CatalogStore`].
//!
//! Written to work with serverless Postgres (Neon, Supabase, Aurora Serverless):
//! connections are few and short-lived, the first connect is retried (a scaled-to-zero database
//! takes a moment to wake), and a connection pooler in transaction mode is supported by turning
//! off the prepared-statement cache. Migrations should run over a direct connection because
//! sqlx serialises them with a session-level advisory lock.

use std::str::FromStr;
use std::time::Duration;

use anyhow::{Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;

use super::{sort_by_semver_desc, CatalogStore, DbOptions, InsertItemError};
use crate::models::{AuditEntry, AuditQuery, ItemVersionRow, TakedownLogRow, ITEM_VERSION_COLUMNS};

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations/postgres");

/// Connection attempts at startup, spaced by [`CONNECT_BACKOFF`].
const CONNECT_ATTEMPTS: u32 = 5;
const CONNECT_BACKOFF: Duration = Duration::from_secs(2);

pub struct PostgresStore {
    pool: PgPool,
}

impl PostgresStore {
    pub async fn open(database_url: &str, options: &DbOptions) -> Result<Self> {
        let mut connect =
            PgConnectOptions::from_str(database_url).context("parse DATABASE_URL (postgres)")?;
        if options.pooler {
            // A transaction-mode pooler hands each statement to a different server connection,
            // so named prepared statements would not be there on the next one.
            connect = connect.statement_cache_capacity(0);
        }

        let mut last_error = None;
        for attempt in 1..=CONNECT_ATTEMPTS {
            let result = PgPoolOptions::new()
                .max_connections(options.max_connections)
                .min_connections(0)
                .acquire_timeout(options.acquire_timeout)
                // Serverless providers drop idle connections; retire ours first.
                .idle_timeout(Some(Duration::from_secs(300)))
                .max_lifetime(Some(Duration::from_secs(1800)))
                .test_before_acquire(true)
                .connect_with(connect.clone())
                .await;
            match result {
                Ok(pool) => return Ok(Self { pool }),
                Err(error) => {
                    tracing::warn!(attempt, %error, "postgres connection failed");
                    last_error = Some(error);
                    if attempt < CONNECT_ATTEMPTS {
                        tokio::time::sleep(CONNECT_BACKOFF).await;
                    }
                }
            }
        }
        Err(last_error.expect("at least one attempt")).context("connect to postgres")
    }

    /// Underlying pool, for tests that inspect the schema.
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}

#[async_trait]
impl CatalogStore for PostgresStore {
    async fn migrate(&self) -> Result<()> {
        MIGRATOR
            .run(&self.pool)
            .await
            .context("apply postgres migrations")
    }

    async fn insert_item_version(&self, row: &ItemVersionRow) -> Result<(), InsertItemError> {
        let result = sqlx::query(
            r#"
            INSERT INTO item_versions (
                publisher_id, item_type, item_id, version, name, description, min_app_version,
                size_bytes, sha256, storage_key, preview_storage_key, readme, changelog,
                published_at, yanked_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
        // `$1 IS NULL OR col = $1` keeps one statement for every filter combination.
        sqlx::query_as::<_, ItemVersionRow>(&format!(
            r#"
            SELECT {ITEM_VERSION_COLUMNS}
            FROM item_versions
            WHERE yanked_at IS NULL
              AND ($1::text IS NULL OR publisher_id = $1)
              AND ($2::text IS NULL OR item_type = $2)
            ORDER BY publisher_id, item_type, item_id, published_at DESC
            "#
        ))
        .bind(publisher_id)
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
            WHERE yanked_at IS NULL AND publisher_id = $1 AND item_type = $2 AND item_id = $3
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
            WHERE publisher_id = $1 AND item_type = $2 AND item_id = $3 AND version = $4
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
            WHERE publisher_id = $1 AND item_type = $2 AND item_id = $3 AND version = $4
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

    async fn record_download(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<bool> {
        let result = sqlx::query(
            r#"
            UPDATE item_versions SET download_count = download_count + 1
            WHERE publisher_id = $1 AND item_type = $2 AND item_id = $3 AND version = $4
            "#,
        )
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .bind(version)
        .execute(&self.pool)
        .await
        .context("record download")?;
        Ok(result.rows_affected() > 0)
    }

    async fn get_download_count(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        version: &str,
    ) -> Result<Option<i64>> {
        sqlx::query_scalar::<_, i64>(
            r#"
            SELECT download_count FROM item_versions
            WHERE publisher_id = $1 AND item_type = $2 AND item_id = $3 AND version = $4
            "#,
        )
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .bind(version)
        .fetch_optional(&self.pool)
        .await
        .context("get download count")
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
            SET yanked_at = $1
            WHERE publisher_id = $2 AND item_type = $3 AND item_id = $4 AND version = $5
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
            WHERE publisher_id = $1 AND item_type = $2 AND item_id = $3 AND version = $4
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
        audit: Option<&AuditEntry>,
    ) -> Result<Option<ItemVersionRow>> {
        let mut tx = self.pool.begin().await.context("begin purge transaction")?;
        let row = sqlx::query_as::<_, ItemVersionRow>(&format!(
            r#"
            SELECT {ITEM_VERSION_COLUMNS}
            FROM item_versions
            WHERE publisher_id = $1 AND item_type = $2 AND item_id = $3 AND version = $4
            "#
        ))
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .bind(version)
        .fetch_optional(&mut *tx)
        .await
        .context("get version for purge")?;
        if row.is_none() {
            return Ok(None);
        }
        sqlx::query(
            r#"
            DELETE FROM item_versions
            WHERE publisher_id = $1 AND item_type = $2 AND item_id = $3 AND version = $4
            "#,
        )
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .bind(version)
        .execute(&mut *tx)
        .await
        .context("delete item version")?;
        if let Some(entry) = audit {
            insert_audit(&mut *tx, entry).await?;
        }
        tx.commit().await.context("commit purge")?;
        Ok(row)
    }

    async fn delete_item_versions(
        &self,
        publisher_id: &str,
        item_type: &str,
        item_id: &str,
        audit: Option<&AuditEntry>,
    ) -> Result<Vec<ItemVersionRow>> {
        let mut tx = self.pool.begin().await.context("begin purge transaction")?;
        let rows = sqlx::query_as::<_, ItemVersionRow>(&format!(
            r#"
            SELECT {ITEM_VERSION_COLUMNS}
            FROM item_versions
            WHERE publisher_id = $1 AND item_type = $2 AND item_id = $3
            "#
        ))
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .fetch_all(&mut *tx)
        .await
        .context("list item versions for purge")?;

        if rows.is_empty() {
            return Ok(rows);
        }

        sqlx::query(
            r#"
            DELETE FROM item_versions
            WHERE publisher_id = $1 AND item_type = $2 AND item_id = $3
            "#,
        )
        .bind(publisher_id)
        .bind(item_type)
        .bind(item_id)
        .execute(&mut *tx)
        .await
        .context("delete item versions")?;
        if let Some(entry) = audit {
            insert_audit(&mut *tx, entry).await?;
        }
        tx.commit().await.context("commit purge")?;

        Ok(rows)
    }

    async fn insert_audit_entry(&self, entry: &AuditEntry) -> Result<()> {
        insert_audit(&self.pool, entry).await
    }

    async fn list_audit_entries(&self, query: &AuditQuery) -> Result<(Vec<AuditEntry>, i64)> {
        let total: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_log WHERE ($1::text IS NULL OR action = $1) AND ($2::text IS NULL OR publisher_id = $2) AND ($3::text IS NULL OR item_type = $3) AND ($4::text IS NULL OR item_id = $4)",
        )
        .bind(&query.action)
        .bind(&query.publisher_id)
        .bind(&query.item_type)
        .bind(&query.item_id)
        .fetch_one(&self.pool)
        .await
        .context("count audit entries")?;
        let entries = sqlx::query_as::<_, AuditEntry>(
            "SELECT id, at, actor, action, outcome, publisher_id, item_type, item_id, version, reason, client_ip FROM audit_log WHERE ($1::text IS NULL OR action = $1) AND ($2::text IS NULL OR publisher_id = $2) AND ($3::text IS NULL OR item_type = $3) AND ($4::text IS NULL OR item_id = $4) ORDER BY id DESC LIMIT $5 OFFSET $6",
        )
        .bind(&query.action)
        .bind(&query.publisher_id)
        .bind(&query.item_type)
        .bind(&query.item_id)
        .bind(query.limit)
        .bind(query.offset)
        .fetch_all(&self.pool)
        .await
        .context("list audit entries")?;
        Ok((entries, total))
    }

    async fn insert_takedown_log(&self, row: &TakedownLogRow) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO item_takedown_log (
                purged_at, publisher_id, item_type, item_id, version, reason, notice_ref
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
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
            WHERE publisher_id = $1 AND item_type = $2 AND item_id = $3
              AND (version = $4 OR version = '*')
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

/// Insert one audit row on any executor, so it can join a purge's transaction.
async fn insert_audit<'e, E>(executor: E, entry: &AuditEntry) -> Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query(
        r#"
        INSERT INTO audit_log (
            at, actor, action, outcome, publisher_id, item_type, item_id, version, reason,
            client_ip
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
    )
    .bind(entry.at)
    .bind(&entry.actor)
    .bind(&entry.action)
    .bind(&entry.outcome)
    .bind(&entry.publisher_id)
    .bind(&entry.item_type)
    .bind(&entry.item_id)
    .bind(&entry.version)
    .bind(&entry.reason)
    .bind(&entry.client_ip)
    .execute(executor)
    .await
    .context("insert audit_log row")?;
    Ok(())
}
