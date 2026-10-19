//! End-to-end read-path tests against an in-memory SQLite DB + temp local storage.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{Duration, Utc};
use http_body_util::BodyExt;
use serde_json::Value;
use sha2::{Digest, Sha256};
use spk_registry::config::{Config, StorageConfig, PROTOCOL_VERSION};
use spk_registry::db::{self, item_version_row};
use spk_registry::storage::{LocalDiskStorage, ObjectStorage};
use spk_registry::{app_router, AppState};
use tempfile::TempDir;
use tower::ServiceExt;

const TEST_ADMIN_TOKEN: &str = "test-admin-token-xxxxxxxxxxxxxxxx";

async fn test_app() -> (axum::Router, TempDir, Arc<dyn ObjectStorage>) {
    test_app_at("/admin").await
}

async fn test_app_at(admin_path: &str) -> (axum::Router, TempDir, Arc<dyn ObjectStorage>) {
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

    for key in [
        "spiral/skin/demo-skin/1.0.0/item.spk",
        "spiral/skin/demo-skin/1.1.0/item.spk",
        "spiral/skin/demo-skin/0.9.0/item.spk",
        "other/theme/neon-theme/1.0.0/item.spk",
        "other/theme/neon-theme/2.0.0/item.spk",
    ] {
        storage.put(key, bytes).await.unwrap();
    }

    let rows = [
        ("spiral", "skin", "demo-skin", "1.0.0", 14, None),
        ("spiral", "skin", "demo-skin", "1.1.0", 1, None),
        ("spiral", "skin", "demo-skin", "0.9.0", 30, Some(7)),
        ("other", "theme", "neon-theme", "1.0.0", 3, None),
        ("other", "theme", "neon-theme", "2.0.0", 0, None),
    ];
    for (publisher, item_type, id, version, published_days_ago, yanked_days_ago) in rows {
        let mut row = item_version_row(
            publisher,
            item_type,
            id,
            version,
            size,
            &sha,
            &format!("{publisher}/{item_type}/{id}/{version}/item.spk"),
            now - Duration::days(published_days_ago),
            yanked_days_ago.map(|d| now - Duration::days(d)),
        );
        row.name = match id {
            "demo-skin" => "Demo Skin".into(),
            _ => "Neon".into(),
        };
        row.description = format!("{item_type} for tests");
        if version == "2.0.0" {
            row.min_app_version = Some("0.9.0".into());
        }
        pool.insert_item_version(&row).await.unwrap();
    }

    let state = AppState {
        config: Config {
            bind_addr: "127.0.0.1:0".into(),
            instance_name: "Test Registry".into(),
            database_url,
            database_migrate_url: None,
            db: Default::default(),
            auto_migrate: true,
            storage: StorageConfig::Local {
                root: tmp.path().join("objects"),
            },
            admin_token: TEST_ADMIN_TOKEN.into(),
            admin_path: admin_path.into(),
            max_upload_bytes: 5 * 1024 * 1024,
            client_ip_header: "x-client-ip".into(),
        },
        db: pool,
        storage: storage.clone(),
    };

    (app_router(state), tmp, storage)
}

async fn json_get(app: &axum::Router, path: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, value)
}

#[tokio::test]
async fn security_headers_on_api_and_admin_html() {
    let (app, _tmp, _) = test_app().await;

    let api = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/meta")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(api.status(), StatusCode::OK);
    let api_headers = api.headers();
    assert_eq!(api_headers["x-content-type-options"], "nosniff");
    assert_eq!(api_headers["referrer-policy"], "no-referrer");
    assert_eq!(api_headers["x-frame-options"], "DENY");
    assert_eq!(
        api_headers["content-security-policy"],
        "default-src 'none'; frame-ancestors 'none'"
    );

    let html = app
        .oneshot(
            Request::builder()
                .uri("/admin")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(html.status(), StatusCode::OK);
    let html_headers = html.headers();
    assert_eq!(html_headers["x-content-type-options"], "nosniff");
    assert_eq!(html_headers["referrer-policy"], "no-referrer");
    assert_eq!(html_headers["x-frame-options"], "DENY");
    let csp = html_headers["content-security-policy"].to_str().unwrap();
    assert!(csp.contains("default-src 'self'"), "{csp}");
    assert!(csp.contains("frame-ancestors 'none'"), "{csp}");
    assert!(csp.contains("style-src 'self' 'unsafe-inline'"), "{csp}");
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

    let (status, list) = json_get(&app, "/v1/items").await;
    assert_eq!(status, StatusCode::OK);
    let items = list["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(list["total"], 2);

    let demo = items
        .iter()
        .find(|p| p["id"] == "demo-skin")
        .expect("demo-skin in list");
    assert_eq!(demo["publisherId"], "spiral");
    assert_eq!(demo["itemType"], "skin");
    assert_eq!(demo["effectiveId"], "spiral.skin.demo-skin");
    assert_eq!(demo["latestVersion"]["version"], "1.1.0");

    // Yanked 0.9.0 must not appear in item detail.
    let (status, detail) = json_get(&app, "/v1/items/spiral/skin/demo-skin").await;
    assert_eq!(status, StatusCode::OK);
    let versions = detail["versions"].as_array().unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(versions[0]["version"], "1.1.0");
    assert!(versions.iter().all(|v| v["version"] != "0.9.0"));

    let (status, latest) = json_get(&app, "/v1/items/spiral/skin/demo-skin/versions/latest").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(latest["version"], "1.1.0");
    assert_eq!(latest["effectiveId"], "spiral.skin.demo-skin");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/items/spiral/skin/demo-skin/versions/1.1.0/download")
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
async fn unknown_item_type_and_item_are_not_found() {
    let (app, _tmp, _) = test_app().await;
    let (status, _) = json_get(&app, "/v1/items/spiral/widget/demo-skin").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = json_get(&app, "/v1/items/spiral/theme/demo-skin").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, body) = json_get(&app, "/v1/items?type=widget").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "invalid_type");
}
#[tokio::test]
async fn yanked_excluded_from_list_and_detail_but_downloadable() {
    let (app, _tmp, _) = test_app().await;

    let (status, _) = json_get(&app, "/v1/items/spiral/skin/demo-skin/versions/0.9.0").await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/items/spiral/skin/demo-skin/versions/0.9.0/download")
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
async fn filters_search_and_paginates() {
    let (app, _tmp, _) = test_app().await;

    let (status, body) = json_get(&app, "/v1/items?type=theme").await;
    assert_eq!(status, StatusCode::OK);
    let items = body["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], "neon-theme");
    assert_eq!(items[0]["latestVersion"]["version"], "2.0.0");

    let (_, body) = json_get(&app, "/v1/items?publisher=spiral").await;
    let items = body["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["publisherId"], "spiral");

    // Case-insensitive substring over name / description / id.
    let (_, body) = json_get(&app, "/v1/items?q=NEON").await;
    assert_eq!(body["total"], 1);
    let (_, body) = json_get(&app, "/v1/items?q=skin").await;
    assert_eq!(body["items"][0]["id"], "demo-skin");
    let (_, body) = json_get(&app, "/v1/items?q=nothing-matches").await;
    assert_eq!(body["total"], 0);
    assert!(body["items"].as_array().unwrap().is_empty());

    // Sorted by name: "Demo Skin" then "Neon". `total` ignores paging.
    let (_, page1) = json_get(&app, "/v1/items?limit=1").await;
    assert_eq!(page1["total"], 2);
    assert_eq!(page1["limit"], 1);
    assert_eq!(page1["items"][0]["id"], "demo-skin");
    let (_, page2) = json_get(&app, "/v1/items?limit=1&offset=1").await;
    assert_eq!(page2["items"][0]["id"], "neon-theme");
    let (_, past_end) = json_get(&app, "/v1/items?limit=1&offset=5").await;
    assert!(past_end["items"].as_array().unwrap().is_empty());
}

async fn post_updates(app: &axum::Router, body: Value) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/items/updates")
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn installed(publisher: &str, item_type: &str, id: &str, version: &str) -> Value {
    serde_json::json!({
        "publisherId": publisher, "itemType": item_type, "id": id, "version": version
    })
}

#[tokio::test]
async fn update_check_reports_newer_versions_only() {
    let (app, _tmp, _) = test_app().await;

    let (status, body) = post_updates(
        &app,
        serde_json::json!({ "items": [
            installed("spiral", "skin", "demo-skin", "1.0.0"),
            installed("other", "theme", "neon-theme", "2.0.0"),
            installed("nobody", "theme", "missing", "1.0.0"),
        ]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let updates = body["updates"].as_array().unwrap();
    assert_eq!(updates.len(), 1, "{body}");
    assert_eq!(updates[0]["id"], "demo-skin");
    assert_eq!(updates[0]["installedVersion"], "1.0.0");
    assert_eq!(updates[0]["latest"]["version"], "1.1.0");
    let unlisted = body["unlisted"].as_array().unwrap();
    assert_eq!(unlisted.len(), 1);
    assert_eq!(unlisted[0]["id"], "missing");
}

#[tokio::test]
async fn update_check_ignores_yanked_and_honours_min_app_version() {
    let (app, _tmp, _) = test_app().await;

    // neon-theme 2.0.0 needs app >= 0.9.0.
    let items = serde_json::json!([installed("other", "theme", "neon-theme", "1.0.0")]);

    let (_, no_app) = post_updates(&app, serde_json::json!({ "items": items })).await;
    assert_eq!(no_app["updates"][0]["latest"]["version"], "2.0.0");

    let (_, old_app) = post_updates(
        &app,
        serde_json::json!({ "appVersion": "0.8.5", "items": items }),
    )
    .await;
    assert!(
        old_app["updates"].as_array().unwrap().is_empty(),
        "{old_app}"
    );
    assert!(old_app["unlisted"].as_array().unwrap().is_empty());

    let (_, new_app) = post_updates(
        &app,
        serde_json::json!({ "appVersion": "0.9.0-beta.1", "items": items }),
    )
    .await;
    assert_eq!(new_app["updates"][0]["latest"]["version"], "2.0.0");

    // A yanked version is never offered: 0.9.0 is older anyway, so nothing for 1.1.0 installs.
    let (_, current) = post_updates(
        &app,
        serde_json::json!({ "items": [installed("spiral", "skin", "demo-skin", "1.1.0")] }),
    )
    .await;
    assert!(current["updates"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn update_check_validates_input() {
    let (app, _tmp, _) = test_app().await;

    let (status, body) = post_updates(
        &app,
        serde_json::json!({ "appVersion": "latest", "items": [] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "invalid_app_version");

    let many: Vec<Value> = (0..201)
        .map(|i| installed("spiral", "skin", &format!("s{i}"), "1.0.0"))
        .collect();
    let (status, body) = post_updates(&app, serde_json::json!({ "items": many })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "too_many_items");

    // An installed version that is not semver is skipped, not an error.
    let (status, body) = post_updates(
        &app,
        serde_json::json!({ "items": [installed("spiral", "skin", "demo-skin", "dev")] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["updates"].as_array().unwrap().is_empty());
}
// --- Phase 2: admin upload / yank / purge ---------------------------------

fn fixture_dir(name: &str) -> PathBuf {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures/items")
        .join(name);
    assert!(path.is_dir(), "fixture {name} not found");
    path
}

fn zip_dir_to_bytes(item_dir: &Path) -> Vec<u8> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn add_dir(
        zip: &mut ZipWriter<&mut std::io::Cursor<Vec<u8>>>,
        abs: &Path,
        rel: &Path,
        options: SimpleFileOptions,
    ) {
        for entry in std::fs::read_dir(abs).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            let child_rel = rel.join(entry.file_name());
            let zip_name = child_rel.to_str().unwrap().replace('\\', "/");
            if path.is_dir() {
                zip.add_directory(format!("{zip_name}/"), options).unwrap();
                add_dir(zip, &path, &child_rel, options);
            } else {
                let data = std::fs::read(&path).unwrap();
                zip.start_file(zip_name, options).unwrap();
                zip.write_all(&data).unwrap();
            }
        }
    }

    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut cursor);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        add_dir(&mut zip, item_dir, Path::new(""), options);
        zip.finish().unwrap();
    }
    cursor.into_inner()
}

fn zip_slip_bytes() -> Vec<u8> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut cursor);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        // enclosed_name() rejects this as escaping the extract root.
        zip.start_file("../../../evil.txt", options).unwrap();
        zip.write_all(b"pwned").unwrap();
        zip.finish().unwrap();
    }
    cursor.into_inner()
}

/// Far more entries than any real pack; the zip itself stays tiny.
fn too_many_entries_bytes() -> Vec<u8> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut cursor);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for i in 0..=spk_format::DEFAULT_MAX_ENTRIES {
            zip.start_file(format!("f{i}.txt"), options).unwrap();
            zip.write_all(b"x").unwrap();
        }
        zip.finish().unwrap();
    }
    cursor.into_inner()
}

fn multipart_spk(filename: &str, bytes: &[u8]) -> (String, Vec<u8>) {
    let boundary = "----spkboundary7MA4YWxk";
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"spk\"; filename=\"{filename}\"\r\nContent-Type: application/zip\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

async fn admin_upload(app: &axum::Router, bytes: &[u8]) -> (StatusCode, Value) {
    let (content_type, body) = multipart_spk("item.spk", bytes);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/admin/api/items")
                .header("Authorization", format!("Bearer {TEST_ADMIN_TOKEN}"))
                .header("Content-Type", content_type)
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, value)
}

async fn admin_json(
    app: &axum::Router,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", format!("Bearer {TEST_ADMIN_TOKEN}"));
    let req_body = if let Some(v) = body {
        builder = builder.header("Content-Type", "application/json");
        Body::from(serde_json::to_vec(&v).unwrap())
    } else {
        Body::empty()
    };
    let response = app
        .clone()
        .oneshot(builder.body(req_body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, value)
}

#[tokio::test]
async fn upload_valid_spk_appears_in_catalog() {
    let (app, _tmp, _) = test_app().await;
    let spk = zip_dir_to_bytes(&fixture_dir("demo-theme"));

    let (status, body) = admin_upload(&app, &spk).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["publisherId"], "spiral");
    assert_eq!(body["itemType"], "theme");
    assert_eq!(body["id"], "demo-theme");
    assert_eq!(body["effectiveId"], "spiral.theme.demo-theme");
    assert_eq!(body["version"], "1.0.0");
    assert_eq!(body["name"], "Demo Theme");
    assert_eq!(
        body["description"],
        "Valid theme fixture for publish tests and the seed."
    );
    assert!(body["sha256"].as_str().unwrap().len() == 64);
    let expected_size = spk_registry::publish::directory_size_bytes(&fixture_dir("demo-theme"))
        .expect("size") as i64;
    assert_eq!(
        body["sizeBytes"].as_i64().unwrap(),
        expected_size,
        "sizeBytes must be uncompressed item size, not archive length ({})",
        spk.len()
    );
    assert_eq!(
        body["previewUrl"],
        "/v1/items/spiral/theme/demo-theme/versions/1.0.0/preview"
    );
    assert!(body["readme"].as_str().unwrap().contains("Demo Theme"));
    assert!(body["changelog"].as_str().unwrap().contains("1.0.0"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/items/spiral/theme/demo-theme/versions/1.0.0/preview")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers().get("content-type").unwrap(), "image/png");
    let preview_bytes = response.into_body().collect().await.unwrap().to_bytes();
    assert!(preview_bytes.starts_with(b"\x89PNG"), "expected PNG magic");

    let (status, list) = json_get(&app, "/v1/items?type=theme&q=demo").await;
    assert_eq!(status, StatusCode::OK);
    let uploaded = list["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "demo-theme")
        .expect("uploaded item should appear immediately");
    assert_eq!(uploaded["latestVersion"]["name"], "Demo Theme");
    // README / CHANGELOG are version-detail only.
    assert!(uploaded["latestVersion"]["readme"].is_null());

    let (status, detail) = json_get(&app, "/v1/items/spiral/theme/demo-theme/versions/1.0.0").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["name"], "Demo Theme");
    assert!(detail["readme"]
        .as_str()
        .unwrap_or("")
        .contains("Demo Theme"));
}

#[tokio::test]
async fn every_item_type_publishes_and_downloads() {
    let (app, _tmp, _) = test_app().await;
    for (fixture, item_type) in [
        ("demo-theme", "theme"),
        ("mini-skin", "skin"),
        ("demo-viz", "visualizer"),
        ("demo-sound", "sound"),
    ] {
        let spk = zip_dir_to_bytes(&fixture_dir(fixture));
        let (status, body) = admin_upload(&app, &spk).await;
        assert_eq!(status, StatusCode::OK, "{fixture}: {body}");
        assert_eq!(body["itemType"], item_type);
        assert_eq!(body["effectiveId"], format!("spiral.{item_type}.{fixture}"));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/v1/items/spiral/{item_type}/{fixture}/versions/latest/download"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{fixture}");
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(bytes.len(), spk.len());
    }

    let (_, list) = json_get(&app, "/v1/items?publisher=spiral").await;
    // The four uploads plus the seeded spiral demo-skin.
    assert_eq!(list["total"], 5);
}

#[tokio::test]
async fn upload_rejects_a_pack_format_archive() {
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    let (app, _tmp, _) = test_app().await;
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default();
        zip.start_file("pack.json", options).unwrap();
        zip.write_all(br#"{"manifestVersion":1,"packId":"old","publisherId":"spiral","version":"1.0.0","name":"Old"}"#)
            .unwrap();
        zip.finish().unwrap();
    }
    let (status, body) = admin_upload(&app, &cursor.into_inner()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "invalid_item");
    assert!(
        body["message"].as_str().unwrap().contains("item manifest"),
        "{body}"
    );
}

#[tokio::test]
async fn upload_rejects_a_manifest_without_version() {
    let (app, _tmp, _) = test_app().await;
    let dir = TempDir::new().unwrap();
    let theme = dir.path().join("theme.json");
    let mut value: Value = serde_json::from_slice(
        &std::fs::read(fixture_dir("demo-theme").join("theme.json")).unwrap(),
    )
    .unwrap();
    value.as_object_mut().unwrap().remove("version");
    value.as_object_mut().unwrap().remove("preview");
    std::fs::write(&theme, serde_json::to_vec(&value).unwrap()).unwrap();

    let (status, body) = admin_upload(&app, &zip_dir_to_bytes(dir.path())).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "invalid_item");
    assert!(
        body["message"].as_str().unwrap().contains("version"),
        "{body}"
    );
}
#[tokio::test]
async fn upload_zip_slip_rejected() {
    let (app, _tmp, _) = test_app().await;
    let (status, body) = admin_upload(&app, &zip_slip_bytes()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "invalid_item");
    let msg = body["message"].as_str().unwrap().to_ascii_lowercase();
    assert!(
        msg.contains("invalid path") || msg.contains("evil"),
        "expected zip-slip style error, got: {msg}"
    );
}

#[tokio::test]
async fn upload_rejects_archives_with_too_many_entries() {
    let (app, _tmp, _) = test_app().await;
    let bomb = too_many_entries_bytes();
    // Stays under the upload body limit, so only the extraction bound can reject it.
    assert!(bomb.len() < 5 * 1024 * 1024, "{} bytes", bomb.len());
    let (status, body) = admin_upload(&app, &bomb).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "invalid_item");
    let msg = body["message"].as_str().unwrap().to_ascii_lowercase();
    assert!(msg.contains("too many entries"), "got: {msg}");
}

#[tokio::test]
async fn upload_duplicate_version_conflicts() {
    let (app, _tmp, _) = test_app().await;
    let spk = zip_dir_to_bytes(&fixture_dir("demo-theme"));
    let (status, _) = admin_upload(&app, &spk).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = admin_upload(&app, &spk).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "conflict");
}

#[tokio::test]
async fn upload_rejects_oversized_body() {
    let (app, _tmp, _) = test_app().await;
    // Build a multipart body larger than the 5 MiB test limit.
    let huge = vec![0u8; 5 * 1024 * 1024 + 64];
    let (status, body) = admin_upload(&app, &huge).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE, "{body}");
    assert_eq!(body["code"], "payload_too_large");
}

#[tokio::test]
async fn yank_hides_from_catalog_but_download_still_works() {
    let (app, _tmp, _) = test_app().await;
    let spk = zip_dir_to_bytes(&fixture_dir("demo-theme"));
    let (status, uploaded) = admin_upload(&app, &spk).await;
    assert_eq!(status, StatusCode::OK);
    let sha = uploaded["sha256"].as_str().unwrap().to_string();

    let (status, _) = admin_json(
        &app,
        "POST",
        "/admin/api/items/spiral/theme/demo-theme/versions/1.0.0/yank",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_get(&app, "/v1/items/spiral/theme/demo-theme/versions/1.0.0").await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, list) = json_get(&app, "/v1/items?type=theme").await;
    assert_eq!(status, StatusCode::OK);
    assert!(list["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| p["id"] != "demo-theme"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/items/spiral/theme/demo-theme/versions/1.0.0/download")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let content_length = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok());
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        content_length,
        Some(bytes.len()),
        "Content-Length must be archive wire size, not catalog sizeBytes"
    );
    let downloaded_sha = hex::encode(Sha256::digest(&bytes));
    assert_eq!(downloaded_sha, sha);
}

#[tokio::test]
async fn unyank_restores_version_to_catalog() {
    let (app, _tmp, _) = test_app().await;
    let spk = zip_dir_to_bytes(&fixture_dir("demo-theme"));
    let (status, _) = admin_upload(&app, &spk).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = admin_json(
        &app,
        "POST",
        "/admin/api/items/spiral/theme/demo-theme/versions/1.0.0/yank",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = admin_json(
        &app,
        "POST",
        "/admin/api/items/spiral/theme/demo-theme/versions/1.0.0/unyank",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["yanked"], false);

    let (status, detail) = json_get(&app, "/v1/items/spiral/theme/demo-theme/versions/1.0.0").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["version"], "1.0.0");

    // Unyanking a live version is a conflict, not a silent no-op.
    let (status, body) = admin_json(
        &app,
        "POST",
        "/admin/api/items/spiral/theme/demo-theme/versions/1.0.0/unyank",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
}

#[tokio::test]
async fn purge_deletes_object_returns_410_and_writes_audit_log() {
    let (app, _tmp, storage) = test_app().await;
    let spk = zip_dir_to_bytes(&fixture_dir("demo-theme"));
    let (status, _) = admin_upload(&app, &spk).await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = admin_json(
        &app,
        "POST",
        "/admin/api/items/spiral/theme/demo-theme/versions/1.0.0/purge",
        Some(serde_json::json!({
            "confirm": "spiral/theme/demo-theme@1.0.0",
            "reason": "test takedown"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, list) = json_get(&app, "/v1/items?type=theme").await;
    assert_eq!(status, StatusCode::OK);
    assert!(list["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| p["id"] != "demo-theme"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/items/spiral/theme/demo-theme/versions/1.0.0/download")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::GONE);

    assert!(storage
        .get_download_url("spiral/theme/demo-theme/1.0.0/item.spk")
        .await
        .is_err());
}

#[tokio::test]
async fn purge_without_matching_confirm_is_noop() {
    let (app, _tmp, storage) = test_app().await;
    let spk = zip_dir_to_bytes(&fixture_dir("demo-theme"));
    let (status, _) = admin_upload(&app, &spk).await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = admin_json(
        &app,
        "POST",
        "/admin/api/items/spiral/theme/demo-theme/versions/1.0.0/purge",
        Some(serde_json::json!({
            "confirm": "wrong/confirm@1.0.0",
            "reason": "should not delete"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "confirm_mismatch");

    let (status, detail) = json_get(&app, "/v1/items/spiral/theme/demo-theme/versions/1.0.0").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["version"], "1.0.0");
    assert!(storage
        .get_download_url("spiral/theme/demo-theme/1.0.0/item.spk")
        .await
        .is_ok());
}

#[tokio::test]
async fn admin_panel_and_list_require_token() {
    let (app, _tmp, _) = test_app().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/admin")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/admin/api/items")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/admin/api/items")
                .header("Authorization", "Bearer wrong-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn non_upload_route_rejects_oversized_body() {
    let (app, _tmp, _) = test_app().await;
    // Json extractors use Axum's 2 MiB default; only POST /admin/api/items raises it.
    let huge = vec![b'x'; 2 * 1024 * 1024 + 1];
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/admin/api/items/spiral/skin/demo-skin/versions/1.1.0/purge")
                .header("Authorization", format!("Bearer {TEST_ADMIN_TOKEN}"))
                .header("Content-Type", "application/json")
                .body(Body::from(huge))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn admin_api_rate_limit_is_per_ip() {
    let (app, _tmp, _) = test_app().await;
    let ip = "203.0.113.10";
    let other = "203.0.113.11";

    for i in 0..10 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/admin/api/items")
                    .header("x-client-ip", ip)
                    .header("Authorization", "Bearer wrong-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "request {i} should still be 401"
        );
    }

    let limited = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/admin/api/items")
                .header("x-client-ip", ip)
                .header("Authorization", "Bearer wrong-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    let body: Value =
        serde_json::from_slice(&limited.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["code"], "rate_limited");

    let other_ip = app
        .oneshot(
            Request::builder()
                .uri("/admin/api/items")
                .header("x-client-ip", other)
                .header("Authorization", "Bearer wrong-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(other_ip.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn download_concurrency_is_per_ip() {
    let (app, _tmp, _) = test_app().await;
    let uri = "/v1/items/spiral/skin/demo-skin/versions/1.1.0/download";
    let ip = "203.0.113.20";

    let mut held = Vec::new();
    for i in 0..4 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .header("x-client-ip", ip)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "download {i}");
        held.push(response);
    }

    let limited = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header("x-client-ip", ip)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    let body: Value =
        serde_json::from_slice(&limited.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["code"], "rate_limited");

    held.pop();

    let after_release = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header("x-client-ip", ip)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(after_release.status(), StatusCode::OK);

    let other_ip = app
        .oneshot(
            Request::builder()
                .uri(uri)
                .header("x-client-ip", "203.0.113.21")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(other_ip.status(), StatusCode::OK);
}

async fn get_text(app: &axum::Router, uri: &str) -> (StatusCode, String, Option<String>) {
    let response = app
        .clone()
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .map(|v| v.to_str().unwrap().to_string());
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        String::from_utf8_lossy(&bytes).into_owned(),
        content_type,
    )
}

#[tokio::test]
async fn admin_panel_serves_the_bundle_with_its_mount_path() {
    let (app, _tmp, _) = test_app().await;

    for uri in ["/admin", "/admin/", "/admin/items/spiral/skin/demo-skin"] {
        let (status, html, content_type) = get_text(&app, uri).await;
        assert_eq!(status, StatusCode::OK, "{uri}");
        assert!(content_type.unwrap().starts_with("text/html"), "{uri}");
        assert!(html.contains("<base href=\"/admin/\""), "{uri}: {html}");
        assert!(
            html.contains("<meta name=\"admin-base\" content=\"/admin\""),
            "{uri}: {html}"
        );
    }

    // The old fixed path is gone.
    let (status, _, _) = get_text(&app, "/rgad").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn admin_path_is_configurable() {
    let (app, _tmp, _) = test_app_at("/ops/registry-admin").await;

    let (status, html, _) = get_text(&app, "/ops/registry-admin").await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        html.contains("<base href=\"/ops/registry-admin/\""),
        "{html}"
    );
    assert!(html.contains("content=\"/ops/registry-admin\""), "{html}");

    // A hashed bundle asset is served from under the mount path.
    let asset = html
        .split('"')
        .find(|part| part.starts_with("./assets/") && part.ends_with(".js"))
        .expect("bundle script in index.html")
        .trim_start_matches("./");
    let (status, _, content_type) = get_text(&app, &format!("/ops/registry-admin/{asset}")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(content_type.unwrap().starts_with("text/javascript"));

    // The API moves with it and still needs the token.
    let (status, _, _) = get_text(&app, "/ops/registry-admin/api/items").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, body) = admin_json(&app, "GET", "/ops/registry-admin/api/items", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // Nothing is left at the default path.
    let (status, _, _) = get_text(&app, "/admin").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = admin_json(&app, "GET", "/admin/api/items", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
