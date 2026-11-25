//! The host API over a host database built from the desktop schema
//! (`libs/sync/tests/fixtures/host_schema.sql`) in a temp file, written
//! through its real change log triggers.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use serde_json::{json, Value};
use spiral_host_api::{
    router, serve, serve_connection, DevTokenAuth, HostApi, HostFuture, HostLibrary,
    HostLibraryError, SqliteHostLibrary,
};
use spiral_sync::{ChangesResponse, HostState, Snapshot, SyncCursor};
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tower::ServiceExt;

const SCHEMA: &str = include_str!("../../sync/tests/fixtures/host_schema.sql");
const LIBRARY_ID: &str = "018d0000-0000-7000-8000-00000000f1f0";
const TRACK_A: &str = "018d0000-0000-7000-8000-000000000001";
const TRACK_B: &str = "018d0000-0000-7000-8000-000000000002";
const TOKEN: &str = "test-token-0123456789";

/// A host database in a temp folder, which doubles as the Spiral folder.
struct HostDb {
    dir: TempDir,
}

impl HostDb {
    /// The schema plus one source and one track.
    fn seeded() -> Self {
        let db = HostDb {
            dir: tempfile::tempdir().unwrap(),
        };
        let conn = db.writer();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch(&format!(
            "INSERT INTO sources (id, name, root_path, created_at)
                 VALUES (1, 'Music', 'Music', '2024-01-01T00:00:00Z');
             INSERT INTO tracks (id, title, source_id, rel_path, date_added)
                 VALUES ('{TRACK_A}', 'First', 1, 'a.flac', '2024-01-01T00:00:00Z');"
        ))
        .unwrap();
        db
    }

    fn path(&self) -> PathBuf {
        self.dir.path().join("Library.db")
    }

    /// A writable connection, opened as the desktop app opens it.
    fn writer(&self) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open(self.path()).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn
    }

    fn add_track(&self, id: &str, title: &str) {
        self.writer()
            .execute(
                "INSERT INTO tracks (id, title, source_id, rel_path, date_added)
                 VALUES (?1, ?2, 1, ?1 || '.flac', '2024-01-02T00:00:00Z')",
                [id, title],
            )
            .unwrap();
    }

    async fn router(&self) -> Router {
        let library = SqliteHostLibrary::open(self.path(), self.dir.path())
            .await
            .unwrap();
        assert_eq!(library.spiral_folder(), self.dir.path());
        router(HostApi::new(
            library,
            DevTokenAuth::new(TOKEN),
            unused_cache_dir(),
        ))
    }
}

/// These tests never resize artwork, so nothing is written here.
fn unused_cache_dir() -> PathBuf {
    std::env::temp_dir().join("spiral-host-api-unused-cache")
}

struct Reply {
    status: StatusCode,
    www_authenticate: Option<String>,
    body: Value,
}

async fn get(app: &Router, uri: &str, authorization: Option<&str>) -> Reply {
    send(app, Request::get(uri), authorization).await
}

async fn send(
    app: &Router,
    mut request: axum::http::request::Builder,
    authorization: Option<&str>,
) -> Reply {
    let uri = request.uri_ref().unwrap().to_string();
    if let Some(value) = authorization {
        request = request.header("authorization", value);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let www_authenticate = response
        .headers()
        .get("www-authenticate")
        .map(|v| v.to_str().unwrap().to_string());
    assert_eq!(
        response.headers().get("content-type").unwrap(),
        "application/json",
        "{uri} answers JSON"
    );
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    Reply {
        status,
        www_authenticate,
        body: serde_json::from_slice(&bytes).unwrap(),
    }
}

async fn get_ok(app: &Router, uri: &str) -> Value {
    let reply = get(app, uri, Some(&format!("Bearer {TOKEN}"))).await;
    assert_eq!(reply.status, StatusCode::OK, "{uri}: {}", reply.body);
    reply.body
}

fn assert_unauthorized(reply: &Reply) {
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    assert_eq!(reply.www_authenticate.as_deref(), Some("Bearer"));
    assert_eq!(reply.body, json!({ "error": "unauthorized" }));
}

fn rev(body: &Value) -> u64 {
    body["rev"].as_u64().unwrap()
}

#[tokio::test]
async fn library_returns_the_host_state() {
    let db = HostDb::seeded();
    let app = db.router().await;
    let body = get_ok(&app, "/v1/library").await;
    let state: HostState = serde_json::from_value(body.clone()).unwrap();
    assert_eq!(state.library_id.as_str(), LIBRARY_ID);
    assert_eq!(state.oldest_rev.0, 0);
    // The source isn't logged; the track is.
    assert_eq!(state.rev.0, 1);

    db.add_track(TRACK_B, "Second");
    assert_eq!(rev(&get_ok(&app, "/v1/library").await), 2);
}

#[tokio::test]
async fn snapshot_returns_the_catalog() {
    let db = HostDb::seeded();
    db.add_track(TRACK_B, "Second");
    let app = db.router().await;
    let snapshot: Snapshot = serde_json::from_value(get_ok(&app, "/v1/snapshot").await).unwrap();
    assert_eq!(snapshot.library_id.as_str(), LIBRARY_ID);
    assert_eq!(snapshot.rev.0, 2);
    let titles: Vec<_> = snapshot.tracks.iter().map(|t| t.title.as_str()).collect();
    assert_eq!(titles, ["First", "Second"]);
}

#[tokio::test]
async fn changes_returns_what_changed_since_the_cursor() {
    let db = HostDb::seeded();
    let app = db.router().await;
    let since = rev(&get_ok(&app, "/v1/library").await);
    db.add_track(TRACK_B, "Second");

    let body = get_ok(
        &app,
        &format!("/v1/changes?library_id={LIBRARY_ID}&since={since}"),
    )
    .await;
    assert_eq!(body["type"], "changes");
    let ChangesResponse::Changes(set) = serde_json::from_value(body).unwrap() else {
        panic!("expected changes");
    };
    assert_eq!((set.since.0, set.rev.0), (since, since + 1));
    assert_eq!(set.changes.len(), 1);
    assert_eq!(set.changes[0].key().log_id(), TRACK_B);

    // At the host's rev there is nothing to fetch.
    let body = get_ok(
        &app,
        &format!("/v1/changes?library_id={LIBRARY_ID}&since={}", since + 1),
    )
    .await;
    assert_eq!(body["type"], "changes");
    assert_eq!(body["changes"], json!([]));
}

#[tokio::test]
async fn changes_tells_a_client_ahead_to_resnapshot() {
    let db = HostDb::seeded();
    let app = db.router().await;
    let body = get_ok(
        &app,
        &format!("/v1/changes?library_id={LIBRARY_ID}&since=99"),
    )
    .await;
    assert_eq!(
        body,
        json!({
            "type": "resnapshot",
            "reason": "client_ahead",
            "host": { "library_id": LIBRARY_ID, "rev": 1, "oldest_rev": 0 },
        })
    );
}

#[tokio::test]
async fn changes_tells_another_library_to_resnapshot() {
    let db = HostDb::seeded();
    let app = db.router().await;
    let body = get_ok(&app, "/v1/changes?library_id=some-other-library&since=0").await;
    assert_eq!(body["type"], "resnapshot");
    assert_eq!(body["reason"], "different_library");
    assert_eq!(body["host"]["library_id"], LIBRARY_ID);
}

#[tokio::test]
async fn changes_rejects_a_bad_query() {
    let db = HostDb::seeded();
    let app = db.router().await;
    for query in [
        "",
        "?since=0",
        &format!("?library_id={LIBRARY_ID}"),
        &format!("?library_id={LIBRARY_ID}&since=-1"),
        &format!("?library_id={LIBRARY_ID}&since=abc"),
        &format!("?library_id={LIBRARY_ID}&since=18446744073709551616"),
        "?library_id=&since=0",
    ] {
        let reply = get(
            &app,
            &format!("/v1/changes{query}"),
            Some(&format!("Bearer {TOKEN}")),
        )
        .await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "query {query:?}");
        assert!(
            reply.body["error"].is_string(),
            "query {query:?}: {}",
            reply.body
        );
    }
}

#[tokio::test]
async fn every_route_needs_a_valid_bearer_token() {
    let db = HostDb::seeded();
    let app = db.router().await;
    let uris = [
        "/v1/library",
        "/v1/snapshot",
        &format!("/v1/changes?library_id={LIBRARY_ID}&since=0"),
    ];
    let bad = [
        None,
        Some("Bearer wrong"),
        Some("Bearer"),
        Some(&format!("Basic {TOKEN}") as &str),
        Some(TOKEN),
        Some(&format!("Bearer {TOKEN}x") as &str),
    ];
    for uri in uris {
        for authorization in bad {
            assert_unauthorized(&get(&app, uri, authorization).await);
        }
        let reply = get(&app, uri, Some(&format!("bearer {TOKEN}"))).await;
        assert_eq!(reply.status, StatusCode::OK, "{uri}");
    }
}

#[tokio::test]
async fn an_unknown_path_is_401_before_404() {
    let db = HostDb::seeded();
    let app = db.router().await;
    for uri in ["/", "/v1", "/v1/nope", "/v2/library", "/admin"] {
        assert_unauthorized(&get(&app, uri, None).await);
        let reply = get(&app, uri, Some(&format!("Bearer {TOKEN}"))).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{uri}");
        assert_eq!(reply.body, json!({ "error": "not found" }));
    }
}

/// Sends one HTTP/1.1 request on `io` and returns the raw response.
async fn raw_request<IO>(mut io: IO, path: &str, authorization: Option<&str>) -> String
where
    IO: AsyncRead + AsyncWrite + Unpin,
{
    let mut request = format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n");
    if let Some(value) = authorization {
        request.push_str(&format!("Authorization: {value}\r\n"));
    }
    request.push_str("\r\n");
    io.write_all(request.as_bytes()).await.unwrap();
    let mut response = Vec::new();
    io.read_to_end(&mut response).await.unwrap();
    String::from_utf8(response).unwrap()
}

fn status_line(response: &str) -> &str {
    response.lines().next().unwrap()
}

fn has_header(response: &str, header: &str) -> bool {
    let head = response.split("\r\n\r\n").next().unwrap();
    head.lines().any(|line| line.eq_ignore_ascii_case(header))
}

#[tokio::test]
async fn loopback_gets_no_trust_over_tcp() {
    let db = HostDb::seeded();
    let app = db.router().await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(serve(listener, app, async {
        let _ = stopped.await;
    }));

    let connect = || tokio::net::TcpStream::connect(addr);
    for authorization in [
        None,
        Some("Bearer wrong"),
        Some(&format!("Basic {TOKEN}") as &str),
    ] {
        let response = raw_request(connect().await.unwrap(), "/v1/library", authorization).await;
        assert_eq!(
            status_line(&response),
            "HTTP/1.1 401 Unauthorized",
            "{authorization:?}"
        );
        assert!(
            has_header(&response, "www-authenticate: Bearer"),
            "{response}"
        );
        assert!(
            response.ends_with(r#"{"error":"unauthorized"}"#),
            "{response}"
        );
    }
    let response = raw_request(connect().await.unwrap(), "/nope", None).await;
    assert_eq!(status_line(&response), "HTTP/1.1 401 Unauthorized");

    let response = raw_request(
        connect().await.unwrap(),
        "/v1/library",
        Some(&format!("Bearer {TOKEN}")),
    )
    .await;
    assert_eq!(status_line(&response), "HTTP/1.1 200 OK");
    assert!(response.contains(LIBRARY_ID), "{response}");

    stop.send(()).unwrap();
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn serve_connection_answers_on_a_connected_stream() {
    let db = HostDb::seeded();
    let app = db.router().await;
    let (client, host) = tokio::io::duplex(64 * 1024);
    let server = tokio::spawn(serve_connection(host, app));

    let response = raw_request(client, "/v1/snapshot", Some(&format!("Bearer {TOKEN}"))).await;
    assert_eq!(status_line(&response), "HTTP/1.1 200 OK");
    let body = response.split("\r\n\r\n").nth(1).unwrap();
    let snapshot: Snapshot = serde_json::from_str(body).unwrap();
    assert_eq!(snapshot.tracks.len(), 1);
    server.await.unwrap().unwrap();

    // Unauthenticated on this transport too.
    let (client, host) = tokio::io::duplex(64 * 1024);
    let server = tokio::spawn(serve_connection(host, db.router().await));
    let response = raw_request(client, "/v1/snapshot", None).await;
    assert_eq!(status_line(&response), "HTTP/1.1 401 Unauthorized");
    server.await.unwrap().unwrap();
}

/// A library whose storage always fails, with details a client must not see.
struct BrokenLibrary;

const SECRET_DETAIL: &str = "/Users/someone/Music/Spiral/Library.db is corrupt";

impl BrokenLibrary {
    fn fail<T>() -> HostFuture<'static, T> {
        Box::pin(async { Err(HostLibraryError::storage(SECRET_DETAIL)) })
    }
}

impl HostLibrary for BrokenLibrary {
    fn host_state(&self) -> HostFuture<'_, HostState> {
        Self::fail()
    }

    fn snapshot(&self) -> HostFuture<'_, Snapshot> {
        Self::fail()
    }

    fn changes<'a>(&'a self, _cursor: &'a SyncCursor) -> HostFuture<'a, ChangesResponse> {
        Self::fail()
    }
}

#[tokio::test]
async fn a_storage_error_is_500_without_details() {
    let app = router(HostApi::new(
        BrokenLibrary,
        DevTokenAuth::new(TOKEN),
        unused_cache_dir(),
    ));
    for uri in [
        "/v1/library",
        "/v1/snapshot",
        "/v1/changes?library_id=x&since=0",
    ] {
        let reply = get(&app, uri, Some(&format!("Bearer {TOKEN}"))).await;
        assert_eq!(reply.status, StatusCode::INTERNAL_SERVER_ERROR, "{uri}");
        assert_eq!(reply.body, json!({ "error": "internal error" }));
        assert!(!reply.body.to_string().contains("corrupt"));
    }
    // Auth still comes first.
    assert_unauthorized(&get(&app, "/v1/library", None).await);
}

#[tokio::test]
async fn file_routes_are_501_when_the_library_has_no_files() {
    // BrokenLibrary keeps the default `track_file` and `artwork_original`.
    let app = router(HostApi::new(
        BrokenLibrary,
        DevTokenAuth::new(TOKEN),
        unused_cache_dir(),
    ));
    for uri in [
        format!("/v1/tracks/{TRACK_A}/audio"),
        format!("/v1/artwork/{}", "a".repeat(64)),
    ] {
        let reply = get(&app, &uri, Some(&format!("Bearer {TOKEN}"))).await;
        assert_eq!(reply.status, StatusCode::NOT_IMPLEMENTED, "{uri}");
        assert_eq!(reply.body, json!({ "error": "not implemented" }));
    }
}

#[tokio::test]
async fn a_wrong_method_is_405_as_json() {
    let db = HostDb::seeded();
    let app = db.router().await;
    for uri in [
        "/v1/library".to_string(),
        "/v1/snapshot".to_string(),
        format!("/v1/tracks/{TRACK_A}/audio"),
        format!("/v1/artwork/{}", "a".repeat(64)),
    ] {
        for method in ["POST", "PUT", "DELETE"] {
            let request = Request::builder().method(method).uri(&uri);
            let reply = send(&app, request, Some(&format!("Bearer {TOKEN}"))).await;
            assert_eq!(
                reply.status,
                StatusCode::METHOD_NOT_ALLOWED,
                "{method} {uri}"
            );
            assert_eq!(reply.body, json!({ "error": "method not allowed" }));
            // And 401 first without a token.
            let request = Request::builder().method(method).uri(&uri);
            assert_unauthorized(&send(&app, request, None).await);
        }
    }
}

#[tokio::test]
async fn open_is_read_only_and_checks_the_database() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("Library.db");
    assert!(SqliteHostLibrary::open(&missing, dir.path()).await.is_err());
    assert!(
        !Path::new(&missing).exists(),
        "a read-only open creates nothing"
    );

    // A database that isn't a Spiral library.
    rusqlite::Connection::open(&missing)
        .unwrap()
        .execute_batch("CREATE TABLE t (x);")
        .unwrap();
    assert!(SqliteHostLibrary::open(&missing, dir.path()).await.is_err());
}

#[tokio::test]
async fn reads_never_write_the_database() {
    let db = HostDb::seeded();
    let app = db.router().await;
    let before = std::fs::read(db.path()).unwrap();
    get_ok(&app, "/v1/snapshot").await;
    get_ok(
        &app,
        &format!("/v1/changes?library_id={LIBRARY_ID}&since=0"),
    )
    .await;
    assert_eq!(std::fs::read(db.path()).unwrap(), before);
}
