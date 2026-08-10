//! End-to-end read-path tests against an in-memory SQLite DB + temp local storage.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{Duration, Utc};
use http_body_util::BodyExt;
use serde_json::Value;
use sha2::{Digest, Sha256};
use spk_registry::config::{Config, StorageConfig, PROTOCOL_VERSION};
use spk_registry::db::{self, pack_version_row};
use spk_registry::storage::{LocalDiskStorage, ObjectStorage};
use spk_registry::{app_router, AppState};
use tempfile::TempDir;
use tower::ServiceExt;

async fn test_app() -> (axum::Router, TempDir, Arc<dyn ObjectStorage>) {
    let tmp = TempDir::new().expect("tempdir");
    let db_path = tmp.path().join("test.db");
    let objects = tmp.path().join("objects");
    std::fs::create_dir_all(&objects).unwrap();

    let database_url = format!("sqlite:{}?mode=rwc", db_path.display());
    let pool = db::connect(&database_url).await.expect("db");
    let storage: Arc<dyn ObjectStorage> =
        Arc::new(LocalDiskStorage::new(objects).expect("storage"));

    let bytes = b"PK\x03\x04fake-spk-bytes-for-test";
    let sha = hex::encode(Sha256::digest(bytes));
    let size = bytes.len() as i64;
    let now = Utc::now();

    storage
        .put("spiral/demo-skin/1.0.0.spk", bytes)
        .await
        .unwrap();
    storage
        .put("spiral/demo-skin/1.1.0.spk", bytes)
        .await
        .unwrap();
    storage
        .put("spiral/demo-skin/0.9.0.spk", bytes)
        .await
        .unwrap();
    storage
        .put("other/theme-pack/1.0.0.spk", bytes)
        .await
        .unwrap();

    db::insert_pack_version(
        &pool,
        &pack_version_row(
            "spiral",
            "demo-skin",
            "1.0.0",
            &["skin"],
            size,
            &sha,
            "spiral/demo-skin/1.0.0.spk",
            now - Duration::days(14),
            None,
        ),
    )
    .await
    .unwrap();
    db::insert_pack_version(
        &pool,
        &pack_version_row(
            "spiral",
            "demo-skin",
            "1.1.0",
            &["skin"],
            size,
            &sha,
            "spiral/demo-skin/1.1.0.spk",
            now - Duration::days(1),
            None,
        ),
    )
    .await
    .unwrap();
    db::insert_pack_version(
        &pool,
        &pack_version_row(
            "spiral",
            "demo-skin",
            "0.9.0",
            &["skin"],
            size,
            &sha,
            "spiral/demo-skin/0.9.0.spk",
            now - Duration::days(30),
            Some(now - Duration::days(7)),
        ),
    )
    .await
    .unwrap();
    db::insert_pack_version(
        &pool,
        &pack_version_row(
            "other",
            "theme-pack",
            "1.0.0",
            &["theme"],
            size,
            &sha,
            "other/theme-pack/1.0.0.spk",
            now,
            None,
        ),
    )
    .await
    .unwrap();

    let state = AppState {
        config: Config {
            bind_addr: "127.0.0.1:0".into(),
            instance_name: "Test Registry".into(),
            database_url,
            storage: StorageConfig::Local {
                root: tmp.path().join("objects"),
            },
        },
        db: pool,
        storage: storage.clone(),
    };

    (app_router(state), tmp, storage)
}

async fn json_get(app: &axum::Router, path: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(path)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, value)
}

#[tokio::test]
async fn meta_reports_protocol_version() {
    let (app, _tmp, _) = test_app().await;
    let (status, body) = json_get(&app, "/v1/meta").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["protocolVersion"], PROTOCOL_VERSION);
    assert_eq!(body["name"], "Test Registry");
}

#[tokio::test]
async fn list_detail_download_end_to_end() {
    let (app, _tmp, _) = test_app().await;

    let (status, list) = json_get(&app, "/v1/packs").await;
    assert_eq!(status, StatusCode::OK);
    let packs = list["packs"].as_array().unwrap();
    assert_eq!(packs.len(), 2);

    let demo = packs
        .iter()
        .find(|p| p["packId"] == "demo-skin")
        .expect("demo-skin in list");
    assert_eq!(demo["latestVersion"]["version"], "1.1.0");

    // Yanked 0.9.0 must not appear in pack detail.
    let (status, detail) = json_get(&app, "/v1/packs/spiral/demo-skin").await;
    assert_eq!(status, StatusCode::OK);
    let versions = detail["versions"].as_array().unwrap();
    assert_eq!(versions.len(), 2);
    assert!(versions.iter().all(|v| v["version"] != "0.9.0"));

    let (status, latest) =
        json_get(&app, "/v1/packs/spiral/demo-skin/versions/latest").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(latest["version"], "1.1.0");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/packs/spiral/demo-skin/versions/1.1.0/download")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&bytes[..], b"PK\x03\x04fake-spk-bytes-for-test");
}

#[tokio::test]
async fn yanked_excluded_from_list_and_detail_but_downloadable() {
    let (app, _tmp, _) = test_app().await;

    let (status, _) = json_get(&app, "/v1/packs/spiral/demo-skin/versions/0.9.0").await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/packs/spiral/demo-skin/versions/0.9.0/download")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&bytes[..], b"PK\x03\x04fake-spk-bytes-for-test");
}

#[tokio::test]
async fn filters_by_contribution_type_and_author() {
    let (app, _tmp, _) = test_app().await;

    let (status, body) = json_get(&app, "/v1/packs?contributionType=theme").await;
    assert_eq!(status, StatusCode::OK);
    let packs = body["packs"].as_array().unwrap();
    assert_eq!(packs.len(), 1);
    assert_eq!(packs[0]["packId"], "theme-pack");

    let (status, body) = json_get(&app, "/v1/packs?authorId=spiral").await;
    assert_eq!(status, StatusCode::OK);
    let packs = body["packs"].as_array().unwrap();
    assert_eq!(packs.len(), 1);
    assert_eq!(packs[0]["authorId"], "spiral");
}
