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
use spk_registry::db::{self, pack_version_row};
use spk_registry::storage::{LocalDiskStorage, ObjectStorage};
use spk_registry::{app_router, AppState};
use tempfile::TempDir;
use tower::ServiceExt;

const TEST_ADMIN_TOKEN: &str = "test-admin-token-xxxxxxxxxxxxxxxx";

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
        .put("spiral/demo-skin/1.0.0/pack.spk", bytes)
        .await
        .unwrap();
    storage
        .put("spiral/demo-skin/1.1.0/pack.spk", bytes)
        .await
        .unwrap();
    storage
        .put("spiral/demo-skin/0.9.0/pack.spk", bytes)
        .await
        .unwrap();
    storage
        .put("other/theme-pack/1.0.0/pack.spk", bytes)
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
            "spiral/demo-skin/1.0.0/pack.spk",
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
            "spiral/demo-skin/1.1.0/pack.spk",
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
            "spiral/demo-skin/0.9.0/pack.spk",
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
            "other/theme-pack/1.0.0/pack.spk",
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
            admin_token: TEST_ADMIN_TOKEN.into(),
            max_upload_bytes: 5 * 1024 * 1024,
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
                .uri("/rgad")
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

// --- Phase 2: admin upload / yank / purge ---------------------------------

fn fixture_valid_theme_dir() -> PathBuf {
    let candidates = [
        PathBuf::from("fixtures/valid-theme"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/valid-theme"),
    ];
    for path in candidates {
        if path.join("pack.json").is_file() {
            return path;
        }
    }
    panic!("fixtures/valid-theme not found");
}

fn zip_dir_to_bytes(pack_dir: &Path) -> Vec<u8> {
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
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        add_dir(&mut zip, pack_dir, Path::new(""), options);
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
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        // enclosed_name() rejects this as escaping the extract root.
        zip.start_file("../../../evil.txt", options).unwrap();
        zip.write_all(b"pwned").unwrap();
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
    let (content_type, body) = multipart_spk("pack.spk", bytes);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/rgad/packs")
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
    let spk = zip_dir_to_bytes(&fixture_valid_theme_dir());

    let (status, body) = admin_upload(&app, &spk).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["authorId"], "spiral");
    assert_eq!(body["packId"], "demo-theme");
    assert_eq!(body["version"], "1.0.0");
    assert_eq!(body["name"], "Demo Theme");
    assert_eq!(
        body["description"],
        "Valid theme fixture for admin upload testing."
    );
    assert!(body["sha256"].as_str().unwrap().len() == 64);
    let fixture = fixture_valid_theme_dir();
    let expected_size =
        spk_registry::publish::directory_size_bytes(&fixture).expect("fixture size") as i64;
    assert_eq!(
        body["sizeBytes"].as_i64().unwrap(),
        expected_size,
        "sizeBytes must be uncompressed pack size, not archive length ({})",
        spk.len()
    );
    assert_eq!(
        body["previewUrl"],
        "/v1/packs/spiral/demo-theme/versions/1.0.0/preview"
    );
    let contributions = body["contributions"].as_array().expect("contributions");
    assert_eq!(contributions.len(), 1);
    assert_eq!(contributions[0]["type"], "theme");
    assert_eq!(contributions[0]["localId"], "demo");
    assert_eq!(contributions[0]["effectiveId"], "spiral.demo-theme.theme.demo");
    assert_eq!(contributions[0]["name"], "Demo Theme");
    assert_eq!(contributions[0]["author"], "spiral");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/packs/spiral/demo-theme/versions/1.0.0/preview")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("content-type").unwrap(),
        "image/png"
    );
    let preview_bytes = response.into_body().collect().await.unwrap().to_bytes();
    assert!(preview_bytes.starts_with(b"\x89PNG"), "expected PNG magic");

    let (status, list) = json_get(&app, "/v1/packs?contributionType=theme").await;
    assert_eq!(status, StatusCode::OK);
    let packs = list["packs"].as_array().unwrap();
    let uploaded = packs
        .iter()
        .find(|p| p["packId"] == "demo-theme")
        .expect("uploaded pack should appear immediately");
    assert_eq!(uploaded["latestVersion"]["name"], "Demo Theme");
    assert_eq!(
        uploaded["latestVersion"]["description"],
        "Valid theme fixture for admin upload testing."
    );
    assert!(uploaded["latestVersion"]["readme"].is_null());
    assert!(uploaded["latestVersion"]["changelog"].is_null());
    assert_eq!(
        uploaded["latestVersion"]["contributions"][0]["name"],
        "Demo Theme"
    );

    let (status, detail) =
        json_get(&app, "/v1/packs/spiral/demo-theme/versions/1.0.0").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["name"], "Demo Theme");
    assert!(
        detail["readme"]
            .as_str()
            .unwrap_or("")
            .contains("Demo Theme"),
        "version detail should include README: {detail}"
    );
    assert!(
        detail["changelog"]
            .as_str()
            .unwrap_or("")
            .contains("1.0.0"),
        "version detail should include CHANGELOG: {detail}"
    );
    assert!(detail["contributions"].as_array().unwrap().len() == 1);
}

#[tokio::test]
async fn upload_zip_slip_rejected() {
    let (app, _tmp, _) = test_app().await;
    let (status, body) = admin_upload(&app, &zip_slip_bytes()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "invalid_pack");
    let msg = body["message"].as_str().unwrap().to_ascii_lowercase();
    assert!(
        msg.contains("invalid path") || msg.contains("evil"),
        "expected zip-slip style error, got: {msg}"
    );
}

#[tokio::test]
async fn upload_duplicate_version_conflicts() {
    let (app, _tmp, _) = test_app().await;
    let spk = zip_dir_to_bytes(&fixture_valid_theme_dir());
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
    let spk = zip_dir_to_bytes(&fixture_valid_theme_dir());
    let (status, uploaded) = admin_upload(&app, &spk).await;
    assert_eq!(status, StatusCode::OK);
    let sha = uploaded["sha256"].as_str().unwrap().to_string();

    let (status, _) = admin_json(
        &app,
        "POST",
        "/v1/rgad/packs/spiral/demo-theme/versions/1.0.0/yank",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_get(&app, "/v1/packs/spiral/demo-theme/versions/1.0.0").await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, list) = json_get(&app, "/v1/packs?contributionType=theme").await;
    assert_eq!(status, StatusCode::OK);
    assert!(list["packs"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| p["packId"] != "demo-theme"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/packs/spiral/demo-theme/versions/1.0.0/download")
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
    let spk = zip_dir_to_bytes(&fixture_valid_theme_dir());
    let (status, _) = admin_upload(&app, &spk).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = admin_json(
        &app,
        "POST",
        "/v1/rgad/packs/spiral/demo-theme/versions/1.0.0/yank",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = admin_json(
        &app,
        "POST",
        "/v1/rgad/packs/spiral/demo-theme/versions/1.0.0/unyank",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["yanked"], false);

    let (status, detail) = json_get(&app, "/v1/packs/spiral/demo-theme/versions/1.0.0").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["version"], "1.0.0");

    // Unyanking a live version is a conflict, not a silent no-op.
    let (status, body) = admin_json(
        &app,
        "POST",
        "/v1/rgad/packs/spiral/demo-theme/versions/1.0.0/unyank",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
}

#[tokio::test]
async fn purge_deletes_object_returns_410_and_writes_audit_log() {
    let (app, _tmp, storage) = test_app().await;
    let spk = zip_dir_to_bytes(&fixture_valid_theme_dir());
    let (status, _) = admin_upload(&app, &spk).await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = admin_json(
        &app,
        "POST",
        "/v1/rgad/packs/spiral/demo-theme/versions/1.0.0/purge",
        Some(serde_json::json!({
            "confirm": "spiral/demo-theme@1.0.0",
            "reason": "test takedown"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, list) = json_get(&app, "/v1/packs?contributionType=theme").await;
    assert_eq!(status, StatusCode::OK);
    assert!(list["packs"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| p["packId"] != "demo-theme"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/packs/spiral/demo-theme/versions/1.0.0/download")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::GONE);

    assert!(storage
        .get_download_url("spiral/demo-theme/1.0.0/pack.spk")
        .await
        .is_err());
}

#[tokio::test]
async fn purge_without_matching_confirm_is_noop() {
    let (app, _tmp, storage) = test_app().await;
    let spk = zip_dir_to_bytes(&fixture_valid_theme_dir());
    let (status, _) = admin_upload(&app, &spk).await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = admin_json(
        &app,
        "POST",
        "/v1/rgad/packs/spiral/demo-theme/versions/1.0.0/purge",
        Some(serde_json::json!({
            "confirm": "wrong/confirm@1.0.0",
            "reason": "should not delete"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "confirm_mismatch");

    let (status, detail) = json_get(&app, "/v1/packs/spiral/demo-theme/versions/1.0.0").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["version"], "1.0.0");
    assert!(storage
        .get_download_url("spiral/demo-theme/1.0.0/pack.spk")
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
                .uri("/rgad")
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
                .uri("/v1/rgad/packs")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/v1/rgad/packs")
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
    // Json extractors use Axum's 2 MiB default; only POST /v1/rgad/packs raises it.
    let huge = vec![b'x'; 2 * 1024 * 1024 + 1];
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/rgad/packs/spiral/demo-skin/versions/1.1.0/purge")
                .header("Authorization", format!("Bearer {TEST_ADMIN_TOKEN}"))
                .header("Content-Type", "application/json")
                .body(Body::from(huge))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}
