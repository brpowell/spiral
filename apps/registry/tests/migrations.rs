//! Schema migration tests: every migration applies to an empty database, applying twice is a
//! no-op, and migration files follow the naming convention.

use std::path::PathBuf;

use spk_registry::db::SqliteStore;
use spk_registry::db::{self, CatalogStore};
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
        vec!["pack_versions", "takedown_log"]
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
    let err = db::open("postgres://localhost/spk").await.err().unwrap();
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

/// `NNNN_snake_case.sql`, numbered contiguously from 0001. A shipped migration is never edited;
/// schema changes always add a new file (sqlx also rejects an edited file by checksum).
#[test]
fn migration_files_follow_the_naming_convention() {
    let names = migration_files("sqlite");
    assert!(!names.is_empty());
    for (i, name) in names.iter().enumerate() {
        let (num, rest) = name.split_once('_').expect("NNNN_name.sql");
        assert_eq!(num.len(), 4, "{name}");
        assert_eq!(
            num.parse::<usize>().unwrap(),
            i + 1,
            "{name} is out of sequence"
        );
        let stem = rest
            .strip_suffix(".sql")
            .unwrap_or_else(|| panic!("{name} must end in .sql"));
        assert!(
            !stem.is_empty()
                && stem
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
            "{name}"
        );
    }
}
