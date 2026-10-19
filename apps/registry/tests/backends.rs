//! One behavioural contract for every catalog backend. SQLite always runs; Postgres runs when
//! `TEST_DATABASE_URL` is set. For a connection-pooler check, point it at the pooler, set
//! `TEST_DATABASE_POOLED=1`, and give the direct URL as `TEST_DATABASE_MIGRATE_URL`.
//! The scenarios use unique ids, so a database can be reused between runs.

use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Duration, SubsecRound, Utc};
use spk_registry::db::{self, item_version_row, CatalogStore, DbOptions, InsertItemError};
use spk_registry::models::{AuditEntry, AuditQuery, ItemVersionRow, TakedownLogRow};
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
        .delete_version(&publisher, "theme", item, "1.0.0", None)
        .await
        .unwrap()
        .expect("deleted row");
    assert_eq!(purged.version, "1.0.0");
    assert!(store
        .delete_version(&publisher, "theme", item, "1.0.0", None)
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
        .delete_item_versions(&publisher, "theme", item, None)
        .await
        .unwrap();
    assert_eq!(
        removed.len(),
        2,
        "1.2.0 and 1.10.0 remain after the single purge"
    );
    assert!(store
        .delete_item_versions(&publisher, "theme", item, None)
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

    run_audit_contract(store).await;
}

fn audit(
    at: DateTime<Utc>,
    publisher: &str,
    action: &str,
    outcome: &str,
    id: &str,
    version: Option<&str>,
) -> AuditEntry {
    AuditEntry {
        id: 0,
        at,
        actor: "master-token".into(),
        action: action.into(),
        outcome: outcome.into(),
        publisher_id: Some(publisher.into()),
        item_type: Some("theme".into()),
        item_id: Some(id.into()),
        version: version.map(Into::into),
        reason: None,
        client_ip: Some("203.0.113.9".into()),
    }
}

fn audit_query(publisher: &str) -> AuditQuery {
    AuditQuery {
        publisher_id: Some(publisher.into()),
        limit: 50,
        ..Default::default()
    }
}

async fn run_audit_contract(store: &dyn CatalogStore) {
    let publisher = unique("audpub");
    let now = Utc::now().trunc_subsecs(6);

    // --- insert and read back, newest first, with every field round-tripping
    let mut first = audit(now, &publisher, "yank", "success", "a", Some("1.0.0"));
    first.reason = Some("because".into());
    store.insert_audit_entry(&first).await.unwrap();
    store
        .insert_audit_entry(&audit(
            now,
            &publisher,
            "upload",
            "success",
            "b",
            Some("2.0.0"),
        ))
        .await
        .unwrap();
    let mut denied = audit(now, &publisher, "purge_item", "denied", "a", None);
    denied.actor = "unauthenticated".into();
    store.insert_audit_entry(&denied).await.unwrap();

    let (entries, total) = store
        .list_audit_entries(&audit_query(&publisher))
        .await
        .unwrap();
    assert_eq!(total, 3);
    let actions: Vec<_> = entries.iter().map(|e| e.action.as_str()).collect();
    assert_eq!(actions, ["purge_item", "upload", "yank"], "newest first");
    assert!(entries[0].id > entries[1].id && entries[1].id > entries[2].id);
    assert_eq!(entries[0].actor, "unauthenticated");
    assert_eq!(entries[0].version, None);
    assert_eq!(entries[2].reason.as_deref(), Some("because"));
    assert_eq!(entries[2].client_ip.as_deref(), Some("203.0.113.9"));
    assert_eq!(entries[2].at, now);

    // --- filters and paging
    let mut by_action = audit_query(&publisher);
    by_action.action = Some("upload".into());
    let (entries, total) = store.list_audit_entries(&by_action).await.unwrap();
    assert_eq!((entries.len(), total), (1, 1));
    assert_eq!(entries[0].item_id.as_deref(), Some("b"));

    let mut by_item = audit_query(&publisher);
    by_item.item_type = Some("theme".into());
    by_item.item_id = Some("a".into());
    let (_, total) = store.list_audit_entries(&by_item).await.unwrap();
    assert_eq!(total, 2);

    let mut page = audit_query(&publisher);
    page.limit = 1;
    page.offset = 1;
    let (entries, total) = store.list_audit_entries(&page).await.unwrap();
    assert_eq!((entries.len(), total), (1, 3));
    assert_eq!(entries[0].action, "upload");

    let (none, total) = store
        .list_audit_entries(&audit_query(&unique("nobody")))
        .await
        .unwrap();
    assert!(none.is_empty());
    assert_eq!(total, 0);

    // --- a purge writes its audit entry in the same transaction; a no-op purge writes none
    let item = "audited";
    for v in ["1.0.0", "1.1.0"] {
        store
            .insert_item_version(&row(&publisher, "theme", item, v, now))
            .await
            .unwrap();
    }
    let entry = audit(
        now,
        &publisher,
        "purge_version",
        "success",
        item,
        Some("1.0.0"),
    );
    store
        .delete_version(&publisher, "theme", item, "1.0.0", Some(&entry))
        .await
        .unwrap()
        .expect("deleted");
    assert!(store
        .delete_version(&publisher, "theme", item, "1.0.0", Some(&entry))
        .await
        .unwrap()
        .is_none());
    let entry = audit(now, &publisher, "purge_item", "success", item, None);
    assert_eq!(
        store
            .delete_item_versions(&publisher, "theme", item, Some(&entry))
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(store
        .delete_item_versions(&publisher, "theme", item, Some(&entry))
        .await
        .unwrap()
        .is_empty());
    let mut purges = audit_query(&publisher);
    purges.item_id = Some(item.into());
    let (entries, total) = store.list_audit_entries(&purges).await.unwrap();
    assert_eq!(total, 2, "one entry per real purge, none for the no-ops");
    assert_eq!(entries[0].action, "purge_item");
    assert_eq!(entries[1].action, "purge_version");
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
