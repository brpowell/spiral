//! One behavioural contract for every catalog backend. SQLite always runs; Postgres runs when
//! `TEST_DATABASE_URL` is set. For a connection-pooler check, point it at the pooler, set
//! `TEST_DATABASE_POOLED=1`, and give the direct URL as `TEST_DATABASE_MIGRATE_URL`.
//! The scenarios use unique ids, so a database can be reused between runs.

use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Duration, SubsecRound, Utc};
use spk_registry::db::{self, item_version_row, CatalogStore, DbOptions, InsertItemError};
use spk_registry::models::{ItemVersionRow, TakedownLogRow};
use tempfile::TempDir;

fn unique(label: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{label}-{nanos}")
}

fn row(
    publisher: &str,
    item_type: &str,
    id: &str,
    version: &str,
    published_at: DateTime<Utc>,
) -> ItemVersionRow {
    item_version_row(
        publisher,
        item_type,
        id,
        version,
        100,
        &"a".repeat(64),
        &format!("{publisher}/{item_type}/{id}/{version}/item.spk"),
        published_at,
        None,
    )
}

fn versions(rows: &[ItemVersionRow]) -> Vec<&str> {
    rows.iter().map(|r| r.version.as_str()).collect()
}

async fn run_contract(store: &dyn CatalogStore) {
    let publisher = unique("pub");
    let item = "noir";
    let other_item = "grove";
    // Postgres keeps microseconds; SQLite would keep more. Compare at the coarser precision.
    let now = Utc::now().trunc_subsecs(6);

    // --- insert, duplicate, and semver ordering (1.10.0 > 1.2.0, unlike a string sort)
    for (v, age) in [("1.0.0", 3), ("1.2.0", 2), ("1.10.0", 1)] {
        store
            .insert_item_version(&row(
                &publisher,
                "theme",
                item,
                v,
                now - Duration::days(age),
            ))
            .await
            .unwrap_or_else(|e| panic!("insert {v}: {e}"));
    }
    let dup = store
        .insert_item_version(&row(&publisher, "theme", item, "1.2.0", now))
        .await;
    assert!(matches!(dup, Err(InsertItemError::Duplicate)), "{dup:?}");

    let listed = store
        .list_published_versions_for_item(&publisher, "theme", item)
        .await
        .unwrap();
    assert_eq!(versions(&listed), vec!["1.10.0", "1.2.0", "1.0.0"]);
    let latest = store
        .get_latest_published_version(&publisher, "theme", item)
        .await
        .unwrap()
        .expect("latest");
    assert_eq!(latest.version, "1.10.0");
    assert!(store
        .get_latest_published_version(&publisher, "theme", "missing")
        .await
        .unwrap()
        .is_none());

    // --- every field survives a round trip
    let mut full = row(&publisher, "skin", other_item, "2.0.0", now);
    full.name = "Grove".into();
    full.description = "Green and calm".into();
    full.min_app_version = Some("0.4.0".into());
    full.preview_storage_key = Some(format!("{publisher}/skin/{other_item}/2.0.0/preview.png"));
    full.readme = Some("# Grove".into());
    full.changelog = Some("- first".into());
    store.insert_item_version(&full).await.unwrap();
    let got = store
        .get_published_version(&publisher, "skin", other_item, "2.0.0")
        .await
        .unwrap()
        .expect("published");
    assert_eq!(got.name, "Grove");
    assert_eq!(got.description, "Green and calm");
    assert_eq!(got.min_app_version.as_deref(), Some("0.4.0"));
    assert_eq!(got.preview_storage_key, full.preview_storage_key);
    assert_eq!(got.readme.as_deref(), Some("# Grove"));
    assert_eq!(got.changelog.as_deref(), Some("- first"));
    assert_eq!(got.size_bytes, 100);
    assert_eq!(got.sha256, "a".repeat(64));
    assert_eq!(got.storage_key, full.storage_key);
    assert_eq!(got.published_at, now);
    assert!(got.yanked_at.is_none());

    // --- filters by publisher and type
    let all = store
        .list_published_versions(Some(&publisher), None)
        .await
        .unwrap();
    assert_eq!(all.len(), 4);
    let skins = store
        .list_published_versions(Some(&publisher), Some("skin"))
        .await
        .unwrap();
    assert_eq!(versions(&skins), vec!["2.0.0"]);
    let none = store
        .list_published_versions(Some(&unique("nobody")), None)
        .await
        .unwrap();
    assert!(none.is_empty());
    // Unfiltered listing includes ours (other tests' rows may be there too).
    let everything = store.list_published_versions(None, None).await.unwrap();
    assert!(
        everything
            .iter()
            .filter(|r| r.publisher_id == publisher)
            .count()
            == 4
    );

    // --- yank / unyank
    assert!(store
        .yank_version(&publisher, "theme", item, "1.10.0", now)
        .await
        .unwrap());
    assert!(
        !store
            .yank_version(&publisher, "theme", item, "1.10.0", now)
            .await
            .unwrap(),
        "double yank is a no-op"
    );
    assert!(!store
        .yank_version(&publisher, "theme", item, "9.9.9", now)
        .await
        .unwrap());
    assert!(store
        .get_published_version(&publisher, "theme", item, "1.10.0")
        .await
        .unwrap()
        .is_none());
    let yanked = store
        .get_version_for_download(&publisher, "theme", item, "1.10.0")
        .await
        .unwrap()
        .expect("yanked stays downloadable");
    assert_eq!(yanked.yanked_at, Some(now));
    let latest = store
        .get_latest_published_version(&publisher, "theme", item)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(latest.version, "1.2.0", "latest skips yanked versions");
    let admin = store.list_all_versions().await.unwrap();
    assert!(admin
        .iter()
        .any(|r| r.publisher_id == publisher && r.version == "1.10.0" && r.yanked_at.is_some()));

    assert!(store
        .unyank_version(&publisher, "theme", item, "1.10.0")
        .await
        .unwrap());
    assert!(!store
        .unyank_version(&publisher, "theme", item, "1.10.0")
        .await
        .unwrap());
    assert_eq!(
        store
            .get_latest_published_version(&publisher, "theme", item)
            .await
            .unwrap()
            .unwrap()
            .version,
        "1.10.0"
    );

    // --- takedown log
    assert!(!store
        .was_purged(&publisher, "theme", item, "1.0.0")
        .await
        .unwrap());
    let purged = store
        .delete_version(&publisher, "theme", item, "1.0.0")
        .await
        .unwrap()
        .expect("deleted row");
    assert_eq!(purged.version, "1.0.0");
    assert!(store
        .delete_version(&publisher, "theme", item, "1.0.0")
        .await
        .unwrap()
        .is_none());
    store
        .insert_takedown_log(&TakedownLogRow {
            id: 0,
            purged_at: now,
            publisher_id: publisher.clone(),
            item_type: "theme".into(),
            item_id: item.into(),
            version: "1.0.0".into(),
            reason: "test".into(),
            notice_ref: Some("ticket-1".into()),
        })
        .await
        .unwrap();
    assert!(store
        .was_purged(&publisher, "theme", item, "1.0.0")
        .await
        .unwrap());
    assert!(!store
        .was_purged(&publisher, "theme", item, "1.2.0")
        .await
        .unwrap());

    // --- item-level purge
    let removed = store
        .delete_item_versions(&publisher, "theme", item)
        .await
        .unwrap();
    assert_eq!(
        removed.len(),
        2,
        "1.2.0 and 1.10.0 remain after the single purge"
    );
    assert!(store
        .delete_item_versions(&publisher, "theme", item)
        .await
        .unwrap()
        .is_empty());
    store
        .insert_takedown_log(&TakedownLogRow {
            id: 0,
            purged_at: now,
            publisher_id: publisher.clone(),
            item_type: "theme".into(),
            item_id: item.into(),
            version: "*".into(),
            reason: "whole item".into(),
            notice_ref: None,
        })
        .await
        .unwrap();
    assert!(store
        .was_purged(&publisher, "theme", item, "7.7.7")
        .await
        .unwrap());
    // The skin with the same publisher was never purged.
    assert!(!store
        .was_purged(&publisher, "skin", other_item, "2.0.0")
        .await
        .unwrap());
}

#[tokio::test]
async fn sqlite_satisfies_the_contract() {
    let tmp = TempDir::new().unwrap();
    let url = format!("sqlite:{}?mode=rwc", tmp.path().join("c.db").display());
    let store = db::connect(&url).await.expect("connect");
    run_contract(store.as_ref()).await;
}

fn postgres_url() -> Option<String> {
    std::env::var("TEST_DATABASE_URL")
        .ok()
        .filter(|u| !u.trim().is_empty())
}

#[tokio::test]
async fn postgres_satisfies_the_contract() {
    let Some(url) = postgres_url() else {
        eprintln!("skipped: set TEST_DATABASE_URL to run against Postgres");
        return;
    };
    let options = DbOptions {
        pooler: std::env::var("TEST_DATABASE_POOLED").is_ok_and(|v| v == "1" || v == "true"),
        ..DbOptions::default()
    };
    // Migrations take a session-level advisory lock, so behind a transaction pooler they run over
    // the direct URL, exactly as in production (`DATABASE_MIGRATE_URL`).
    let migrate_url = std::env::var("TEST_DATABASE_MIGRATE_URL")
        .ok()
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| url.clone());
    db::open_with(&migrate_url, &DbOptions::default())
        .await
        .expect("open postgres for migrations")
        .migrate()
        .await
        .expect("migrate postgres");

    let store = db::open_with(&url, &options).await.expect("open postgres");
    run_contract(store.as_ref()).await;
}
