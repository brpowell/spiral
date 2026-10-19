//! Schema migration tests: every migration applies to an empty database, applying twice is a
//! no-op, and migration files follow the naming convention.

use std::path::PathBuf;

use spk_registry::db::{self, CatalogStore, PostgresStore, SqliteStore};
use tempfile::TempDir;

fn migrations_dir(backend: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("migrations")
        .join(backend)
}

async fn open_temp() -> (SqliteStore, TempDir) {
    let tmp = TempDir::new().expect("tempdir");
    let url = format!("sqlite:{}?mode=rwc", tmp.path().join("m.db").display());
    (SqliteStore::open(&url).await.expect("open"), tmp)
}

async fn table_names(store: &SqliteStore) -> Vec<String> {
    sqlx::query_scalar::<_, String>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
         AND name != '_sqlx_migrations' ORDER BY name",
    )
    .fetch_all(store.pool())
    .await
    .expect("list tables")
}

#[tokio::test]
async fn migrations_apply_to_an_empty_database() {
    let (store, _tmp) = open_temp().await;
    store.migrate().await.expect("migrate");
    assert_eq!(
        table_names(&store).await,
        vec!["audit_log", "item_takedown_log", "item_versions"]
    );
}

#[tokio::test]
async fn migrating_twice_is_a_no_op() {
    let (store, _tmp) = open_temp().await;
    store.migrate().await.expect("first");
    store.migrate().await.expect("second");
    let applied: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(applied, migration_files("sqlite").len() as i64);
}

#[tokio::test]
async fn connect_applies_migrations() {
    let tmp = TempDir::new().unwrap();
    let url = format!("sqlite:{}?mode=rwc", tmp.path().join("c.db").display());
    let store = db::connect(&url).await.expect("connect");
    assert!(store
        .list_all_versions()
        .await
        .expect("query after connect")
        .is_empty());
}

#[tokio::test]
async fn unsupported_database_url_is_rejected() {
    let err = db::open("mysql://localhost/spk").await.err().unwrap();
    assert!(
        err.to_string().contains("unsupported DATABASE_URL"),
        "{err}"
    );
}

fn migration_files(backend: &str) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(migrations_dir(backend))
        .expect("read migrations dir")
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// The pack-era schema exactly as the live registry created it (before migrations existed, and
/// before the publisher_id rename). Deploying must upgrade that database in place.
const PRE_MIGRATION_SCHEMA: &str = include_str!("pre_migration_schema.sql");

#[tokio::test]
async fn upgrades_a_database_created_before_migrations() {
    let (store, _tmp) = open_temp().await;
    for statement in PRE_MIGRATION_SCHEMA
        .split(';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        sqlx::query(statement)
            .execute(store.pool())
            .await
            .unwrap_or_else(|e| panic!("old schema: {e}\n{statement}"));
    }
    sqlx::query(
        "INSERT INTO pack_versions (author_id, pack_id, version, contribution_types, size_bytes, \
         sha256, storage_key, published_at) VALUES ('spiral', 'wmp-t3', '1.0.0', '[\"skin\"]', 10, \
         'aa', 'spiral/wmp-t3/1.0.0/pack.spk', '2026-10-12T13:10:14Z')",
    )
    .execute(store.pool())
    .await
    .unwrap();

    store
        .migrate()
        .await
        .expect("migrate an existing pack-era database");

    // The pack catalog is gone and the item tables are in place and empty.
    assert_eq!(
        table_names(&store).await,
        vec!["audit_log", "item_takedown_log", "item_versions"]
    );
    assert!(store.list_all_versions().await.unwrap().is_empty());
    store.migrate().await.expect("and a second run is a no-op");
}

/// `NNNN_snake_case.sql`, numbered contiguously from 0001, in every backend's directory. A
/// shipped migration is never edited; schema changes always add a new file (sqlx also rejects an
/// edited file by checksum).
#[test]
fn migration_files_follow_the_naming_convention() {
    for backend in ["sqlite", "postgres"] {
        let names = migration_files(backend);
        assert!(!names.is_empty(), "{backend} has no migrations");
        for (i, name) in names.iter().enumerate() {
            let (num, rest) = name.split_once('_').expect("NNNN_name.sql");
            assert_eq!(num.len(), 4, "{backend}/{name}");
            assert_eq!(
                num.parse::<usize>().unwrap(),
                i + 1,
                "{backend}/{name} is out of sequence"
            );
            let stem = rest
                .strip_suffix(".sql")
                .unwrap_or_else(|| panic!("{backend}/{name} must end in .sql"));
            assert!(
                !stem.is_empty()
                    && stem
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
                "{backend}/{name}"
            );
        }
    }
}

// --- Postgres (needs TEST_DATABASE_URL) -------------------------------------------------

const ITEM_TABLES: [&str; 3] = ["item_versions", "item_takedown_log", "audit_log"];

fn postgres_url() -> Option<String> {
    std::env::var("TEST_DATABASE_URL")
        .ok()
        .filter(|u| !u.trim().is_empty())
}

/// `(table, column, not null)` for the item tables, as SQLite sees them. Primary-key columns
/// count as not null: SQLite leaves `INTEGER PRIMARY KEY` nullable in its metadata only.
async fn sqlite_columns(store: &SqliteStore) -> Vec<(String, String, bool)> {
    let mut out = Vec::new();
    for table in ITEM_TABLES {
        let rows: Vec<(String, i64, i64)> = sqlx::query_as(&format!(
            "SELECT name, \"notnull\", pk FROM pragma_table_info('{table}')"
        ))
        .fetch_all(store.pool())
        .await
        .unwrap();
        out.extend(
            rows.into_iter()
                .map(|(name, notnull, pk)| (table.to_string(), name, notnull != 0 || pk != 0)),
        );
    }
    out.sort();
    out
}

async fn postgres_columns(store: &PostgresStore) -> Vec<(String, String, bool)> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT table_name::text, column_name::text, is_nullable::text \
         FROM information_schema.columns \
         WHERE table_schema = current_schema() AND table_name IN ('item_versions', 'item_takedown_log', 'audit_log')",
    )
    .fetch_all(store.pool())
    .await
    .unwrap();
    let mut out: Vec<_> = rows
        .into_iter()
        .map(|(table, column, nullable)| (table, column, nullable == "NO"))
        .collect();
    out.sort();
    out
}

#[tokio::test]
async fn postgres_migrations_apply_and_are_idempotent() {
    let Some(url) = postgres_url() else {
        eprintln!("skipped: set TEST_DATABASE_URL to run against Postgres");
        return;
    };
    let store = PostgresStore::open(&url, &db::DbOptions::default())
        .await
        .expect("open postgres");
    store.migrate().await.expect("first migrate");
    store.migrate().await.expect("second migrate");
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT table_name::text FROM information_schema.tables \
         WHERE table_schema = current_schema() AND table_name IN ('audit_log', 'item_versions', 'item_takedown_log') ORDER BY 1",
    )
    .fetch_all(store.pool())
    .await
    .unwrap();
    assert_eq!(
        tables,
        vec!["audit_log", "item_takedown_log", "item_versions"]
    );
}

/// The two backends keep separate migration files; this fails the moment their tables or columns
/// (or which columns are required) drift apart.
#[tokio::test]
async fn sqlite_and_postgres_schemas_match() {
    let Some(url) = postgres_url() else {
        eprintln!("skipped: set TEST_DATABASE_URL to run against Postgres");
        return;
    };
    let pg = PostgresStore::open(&url, &db::DbOptions::default())
        .await
        .expect("open postgres");
    pg.migrate().await.expect("migrate postgres");

    let (sqlite, _tmp) = open_temp().await;
    sqlite.migrate().await.expect("migrate sqlite");

    assert_eq!(sqlite_columns(&sqlite).await, postgres_columns(&pg).await);
}
