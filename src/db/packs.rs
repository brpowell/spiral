use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::models::{PackVersionRow, TakedownLogRow, PACK_VERSION_COLUMNS};

#[derive(Debug, thiserror::Error)]
pub enum InsertPackError {
    #[error("pack version already exists")]
    Duplicate,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

/// Insert a published (or already-yanked) pack version row. Used by the seed tool and tests.
pub async fn insert_pack_version(
    pool: &SqlitePool,
    row: &PackVersionRow,
) -> Result<(), InsertPackError> {
    let result = sqlx::query(
        r#"
        INSERT INTO pack_versions (
            author_id, pack_id, version, min_app_version, contribution_types,
            size_bytes, sha256, storage_key, preview_storage_key,
            name, description, readme, contributions,
            published_at, yanked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&row.author_id)
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
    .bind(&row.contributions)
    .bind(row.published_at)
    .bind(row.yanked_at)
    .execute(pool)
    .await;

    match result {
        Ok(_) => Ok(()),
        Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
            Err(InsertPackError::Duplicate)
        }
        Err(e) => Err(InsertPackError::Other(anyhow::Error::new(e).context("insert pack_versions row"))),
    }
}

/// All non-yanked versions, optionally filtered.
pub async fn list_published_versions(
    pool: &SqlitePool,
    author_id: Option<&str>,
    contribution_type: Option<&str>,
) -> Result<Vec<PackVersionRow>> {
    // contribution_types is JSON text; filter that field in Rust after fetch.
    let rows = if let Some(author) = author_id {
        sqlx::query_as::<_, PackVersionRow>(&format!(
            r#"
            SELECT {PACK_VERSION_COLUMNS}
            FROM pack_versions
            WHERE yanked_at IS NULL AND author_id = ?
            ORDER BY author_id, pack_id, published_at DESC
            "#
        ))
        .bind(author)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, PackVersionRow>(&format!(
            r#"
            SELECT {PACK_VERSION_COLUMNS}
            FROM pack_versions
            WHERE yanked_at IS NULL
            ORDER BY author_id, pack_id, published_at DESC
            "#
        ))
        .fetch_all(pool)
        .await
    }
    .context("list published pack versions")?;

    Ok(filter_by_contribution_type(rows, contribution_type))
}

pub async fn list_published_versions_for_pack(
    pool: &SqlitePool,
    author_id: &str,
    pack_id: &str,
) -> Result<Vec<PackVersionRow>> {
    let rows = sqlx::query_as::<_, PackVersionRow>(&format!(
        r#"
        SELECT {PACK_VERSION_COLUMNS}
        FROM pack_versions
        WHERE yanked_at IS NULL AND author_id = ? AND pack_id = ?
        "#
    ))
    .bind(author_id)
    .bind(pack_id)
    .fetch_all(pool)
    .await
    .context("list versions for pack")?;

    Ok(sort_by_semver_desc(rows))
}

/// Published (non-yanked) version detail, or `None` if missing / yanked.
pub async fn get_published_version(
    pool: &SqlitePool,
    author_id: &str,
    pack_id: &str,
    version: &str,
) -> Result<Option<PackVersionRow>> {
    let row = sqlx::query_as::<_, PackVersionRow>(&format!(
        r#"
        SELECT {PACK_VERSION_COLUMNS}
        FROM pack_versions
        WHERE author_id = ? AND pack_id = ? AND version = ? AND yanked_at IS NULL
        "#
    ))
    .bind(author_id)
    .bind(pack_id)
    .bind(version)
    .fetch_optional(pool)
    .await
    .context("get published version")?;
    Ok(row)
}

/// Any stored version including yanked — used for download resolution.
pub async fn get_version_for_download(
    pool: &SqlitePool,
    author_id: &str,
    pack_id: &str,
    version: &str,
) -> Result<Option<PackVersionRow>> {
    let row = sqlx::query_as::<_, PackVersionRow>(&format!(
        r#"
        SELECT {PACK_VERSION_COLUMNS}
        FROM pack_versions
        WHERE author_id = ? AND pack_id = ? AND version = ?
        "#
    ))
    .bind(author_id)
    .bind(pack_id)
    .bind(version)
    .fetch_optional(pool)
    .await
    .context("get version for download")?;
    Ok(row)
}

pub async fn get_latest_published_version(
    pool: &SqlitePool,
    author_id: &str,
    pack_id: &str,
) -> Result<Option<PackVersionRow>> {
    let rows = list_published_versions_for_pack(pool, author_id, pack_id).await?;
    Ok(rows.into_iter().next())
}

fn filter_by_contribution_type(
    rows: Vec<PackVersionRow>,
    contribution_type: Option<&str>,
) -> Vec<PackVersionRow> {
    let Some(wanted) = contribution_type else {
        return rows;
    };
    rows.into_iter()
        .filter(|row| {
            row.contribution_types_vec()
                .iter()
                .any(|t| t == wanted)
        })
        .collect()
}

fn sort_by_semver_desc(mut rows: Vec<PackVersionRow>) -> Vec<PackVersionRow> {
    rows.sort_by(|a, b| compare_version_desc(&a.version, &b.version));
    rows
}

fn compare_version_desc(a: &str, b: &str) -> std::cmp::Ordering {
    match (semver::Version::parse(a), semver::Version::parse(b)) {
        (Ok(va), Ok(vb)) => vb.cmp(&va),
        (Ok(_), Err(_)) => std::cmp::Ordering::Less,
        (Err(_), Ok(_)) => std::cmp::Ordering::Greater,
        (Err(_), Err(_)) => b.cmp(a),
    }
}

/// Collapse version rows into one summary per pack (highest semver wins).
pub fn group_packs_latest(rows: Vec<PackVersionRow>) -> Vec<(String, String, PackVersionRow)> {
    use std::collections::BTreeMap;

    let mut best: BTreeMap<(String, String), PackVersionRow> = BTreeMap::new();
    for row in rows {
        let key = (row.author_id.clone(), row.pack_id.clone());
        match best.get(&key) {
            None => {
                best.insert(key, row);
            }
            Some(existing) => {
                if compare_version_desc(&row.version, &existing.version)
                    == std::cmp::Ordering::Less
                {
                    best.insert(key, row);
                }
            }
        }
    }

    best.into_iter()
        .map(|((author_id, pack_id), row)| (author_id, pack_id, row))
        .collect()
}

/// All versions for admin listing (published + yanked), newest first per pack.
pub async fn list_all_versions(pool: &SqlitePool) -> Result<Vec<PackVersionRow>> {
    let rows = sqlx::query_as::<_, PackVersionRow>(&format!(
        r#"
        SELECT {PACK_VERSION_COLUMNS}
        FROM pack_versions
        ORDER BY author_id, pack_id, published_at DESC
        "#
    ))
    .fetch_all(pool)
    .await
    .context("list all pack versions")?;
    Ok(rows)
}

/// Soft-delete: set `yanked_at`. Returns `false` if the version does not exist.
pub async fn yank_version(
    pool: &SqlitePool,
    author_id: &str,
    pack_id: &str,
    version: &str,
    yanked_at: DateTime<Utc>,
) -> Result<bool> {
    let result = sqlx::query(
        r#"
        UPDATE pack_versions
        SET yanked_at = ?
        WHERE author_id = ? AND pack_id = ? AND version = ? AND yanked_at IS NULL
        "#,
    )
    .bind(yanked_at)
    .bind(author_id)
    .bind(pack_id)
    .bind(version)
    .execute(pool)
    .await
    .context("yank pack version")?;
    Ok(result.rows_affected() > 0)
}

/// Clear `yanked_at` so the version reappears in the public catalog.
/// Returns `false` if the version does not exist or is not currently yanked.
pub async fn unyank_version(
    pool: &SqlitePool,
    author_id: &str,
    pack_id: &str,
    version: &str,
) -> Result<bool> {
    let result = sqlx::query(
        r#"
        UPDATE pack_versions
        SET yanked_at = NULL
        WHERE author_id = ? AND pack_id = ? AND version = ? AND yanked_at IS NOT NULL
        "#,
    )
    .bind(author_id)
    .bind(pack_id)
    .bind(version)
    .execute(pool)
    .await
    .context("unyank pack version")?;
    Ok(result.rows_affected() > 0)
}

/// Delete one version row. Returns the deleted row if it existed.
pub async fn delete_version(
    pool: &SqlitePool,
    author_id: &str,
    pack_id: &str,
    version: &str,
) -> Result<Option<PackVersionRow>> {
    let row = get_version_for_download(pool, author_id, pack_id, version).await?;
    if row.is_none() {
        return Ok(None);
    }
    sqlx::query(
        r#"
        DELETE FROM pack_versions
        WHERE author_id = ? AND pack_id = ? AND version = ?
        "#,
    )
    .bind(author_id)
    .bind(pack_id)
    .bind(version)
    .execute(pool)
    .await
    .context("delete pack version")?;
    Ok(row)
}

/// Delete every version of a pack. Returns the deleted rows.
pub async fn delete_pack_versions(
    pool: &SqlitePool,
    author_id: &str,
    pack_id: &str,
) -> Result<Vec<PackVersionRow>> {
    let rows = sqlx::query_as::<_, PackVersionRow>(&format!(
        r#"
        SELECT {PACK_VERSION_COLUMNS}
        FROM pack_versions
        WHERE author_id = ? AND pack_id = ?
        "#
    ))
    .bind(author_id)
    .bind(pack_id)
    .fetch_all(pool)
    .await
    .context("list pack versions for purge")?;

    if rows.is_empty() {
        return Ok(rows);
    }

    sqlx::query(
        r#"
        DELETE FROM pack_versions
        WHERE author_id = ? AND pack_id = ?
        "#,
    )
    .bind(author_id)
    .bind(pack_id)
    .execute(pool)
    .await
    .context("delete pack versions")?;

    Ok(rows)
}

pub async fn insert_takedown_log(
    pool: &SqlitePool,
    row: &TakedownLogRow,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO takedown_log (
            purged_at, author_id, pack_id, version, reason, notice_ref
        ) VALUES (?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(row.purged_at)
    .bind(&row.author_id)
    .bind(&row.pack_id)
    .bind(&row.version)
    .bind(&row.reason)
    .bind(&row.notice_ref)
    .execute(pool)
    .await
    .context("insert takedown_log row")?;
    Ok(())
}

/// True if this exact version (or a pack-level `*`) was purged.
pub async fn was_purged(
    pool: &SqlitePool,
    author_id: &str,
    pack_id: &str,
    version: &str,
) -> Result<bool> {
    let count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM takedown_log
        WHERE author_id = ? AND pack_id = ?
          AND (version = ? OR version = '*')
        "#,
    )
    .bind(author_id)
    .bind(pack_id)
    .bind(version)
    .fetch_one(pool)
    .await
    .context("query takedown_log")?;
    Ok(count > 0)
}

/// Helper for tests / seed: build a row with JSON contribution_types.
#[allow(clippy::too_many_arguments)]
pub fn pack_version_row(
    author_id: &str,
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
        author_id: author_id.to_string(),
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
        contributions: "[]".to_string(),
        published_at,
        yanked_at,
    }
}
