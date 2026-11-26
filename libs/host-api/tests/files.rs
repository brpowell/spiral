//! Track audio and artwork over real files: a Spiral folder and a host
//! database built from the desktop schema
//! (`libs/sync/tests/fixtures/host_schema.sql`) in temp folders.

use axum::body::Body;
use axum::http::{HeaderMap, Request, StatusCode};
use axum::Router;
use image::{DynamicImage, GenericImageView, ImageFormat, RgbImage, RgbaImage};
use serde_json::{json, Value};
use spiral_host_api::{router, DevTokenAuth, HostApi, SqliteHostLibrary};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tempfile::TempDir;
use tower::ServiceExt;

const SCHEMA: &str = include_str!("../../sync/tests/fixtures/host_schema.sql");
const TOKEN: &str = "test-token-0123456789";

const IN_MUSIC: &str = "018d0000-0000-7000-8000-000000000001";
const IN_ABSOLUTE: &str = "018d0000-0000-7000-8000-000000000002";
const DOT_DOT: &str = "018d0000-0000-7000-8000-000000000003";
const SYMLINK_OUT: &str = "018d0000-0000-7000-8000-000000000004";
const MISSING: &str = "018d0000-0000-7000-8000-000000000005";
const UNKNOWN: &str = "018d0000-0000-7000-8000-0000000000ff";

/// An opaque 800x400 PNG.
const WIDE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
/// A 500x1000 PNG with alpha.
const TALL_ALPHA: &str = "2222222222222222222222222222222222222222222222222222222222222222";
/// A 100x80 JPEG.
const SMALL: &str = "3333333333333333333333333333333333333333333333333333333333333333";
/// Recorded with the wrong size.
const WRONG_SIZE: &str = "4444444444444444444444444444444444444444444444444444444444444444";
/// Recorded with the wrong modified time.
const WRONG_MTIME: &str = "5555555555555555555555555555555555555555555555555555555555555555";
/// Recorded outside `Artwork/`.
const OUTSIDE_ARTWORK: &str = "6666666666666666666666666666666666666666666666666666666666666666";
/// Not in the database.
const UNKNOWN_HASH: &str = "7777777777777777777777777777777777777777777777777777777777777777";

/// Bytes that make range checks meaningful: every offset holds a known value.
fn audio_bytes(seed: u8) -> Vec<u8> {
    (0..10_000u32)
        .map(|i| (i as u8).wrapping_mul(7).wrapping_add(seed))
        .collect()
}

fn encode(image: DynamicImage, format: ImageFormat) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    image.write_to(&mut out, format).unwrap();
    out.into_inner()
}

fn stat(path: &Path) -> (i64, i64) {
    let meta = fs::metadata(path).unwrap();
    let mtime = meta
        .modified()
        .unwrap()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    (meta.len() as i64, mtime)
}

struct Host {
    /// The Spiral folder, holding `Library.db`, `Music/` and `Artwork/`.
    spiral: TempDir,
    /// A source root outside the Spiral folder, plus a file nobody may serve.
    outside: TempDir,
    cache: TempDir,
}

impl Host {
    fn new() -> Self {
        let host = Host {
            spiral: tempfile::tempdir().unwrap(),
            outside: tempfile::tempdir().unwrap(),
            cache: tempfile::tempdir().unwrap(),
        };
        let spiral = host.spiral.path();
        let outside = host.outside.path();
        let abs_root = outside.join("Absolute");
        fs::create_dir_all(spiral.join("Music/Album")).unwrap();
        fs::create_dir_all(&abs_root).unwrap();
        fs::write(spiral.join("Music/Album/a.flac"), audio_bytes(1)).unwrap();
        fs::write(abs_root.join("b.mp3"), audio_bytes(2)).unwrap();
        // Reachable by `..` from the Music root, and by the symlink.
        fs::write(spiral.join("secret.flac"), b"not yours").unwrap();
        fs::write(outside.join("secret.flac"), b"not yours").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            outside.join("secret.flac"),
            spiral.join("Music/Album/link.flac"),
        )
        .unwrap();

        let conn = rusqlite::Connection::open(host.db_path()).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
            "INSERT INTO sources (id, name, root_path, created_at) VALUES
                 (1, 'Music', 'Music', '2024-01-01T00:00:00Z'),
                 (2, 'Elsewhere', ?1, '2024-01-01T00:00:00Z')",
            [abs_root.to_str().unwrap()],
        )
        .unwrap();
        for (id, source, rel_path) in [
            (IN_MUSIC, 1, "Album/a.flac"),
            (IN_ABSOLUTE, 2, "b.mp3"),
            (DOT_DOT, 1, "../secret.flac"),
            (SYMLINK_OUT, 1, "Album/link.flac"),
            (MISSING, 1, "Album/gone.flac"),
        ] {
            conn.execute(
                "INSERT INTO tracks (id, title, source_id, rel_path, date_added)
                 VALUES (?1, 'T', ?2, ?3, '2024-01-01T00:00:00Z')",
                rusqlite::params![id, source, rel_path],
            )
            .unwrap();
        }

        let wide = encode(
            DynamicImage::ImageRgb8(RgbImage::from_pixel(800, 400, [200, 30, 30].into())),
            ImageFormat::Png,
        );
        let tall = encode(
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(500, 1000, [0, 0, 255, 128].into())),
            ImageFormat::Png,
        );
        let small = encode(
            DynamicImage::ImageRgb8(RgbImage::from_pixel(100, 80, [10, 200, 10].into())),
            ImageFormat::Jpeg,
        );
        // (hash, rel_path, bytes, offset added to the recorded (size, mtime_ms))
        let images = [
            (WIDE, "Artwork/Albums/wide.png", wide.as_slice(), (0, 0)),
            (
                TALL_ALPHA,
                "Artwork/Albums/tall.png",
                tall.as_slice(),
                (0, 0),
            ),
            (SMALL, "Artwork/Albums/small.jpg", small.as_slice(), (0, 0)),
            (
                WRONG_SIZE,
                "Artwork/Albums/size.jpg",
                small.as_slice(),
                (1, 0),
            ),
            (
                WRONG_MTIME,
                "Artwork/Albums/mtime.jpg",
                small.as_slice(),
                (0, 1),
            ),
            (OUTSIDE_ARTWORK, "Music/cover.jpg", small.as_slice(), (0, 0)),
        ];
        for (hash, rel_path, bytes, (size_off, mtime_off)) in images {
            let path = spiral.join(rel_path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bytes).unwrap();
            let (size, mtime) = stat(&path);
            let mime = if rel_path.ends_with(".png") {
                "image/png"
            } else {
                "image/jpeg"
            };
            let (w, h) = image::load_from_memory(bytes).unwrap().dimensions();
            conn.execute(
                "INSERT INTO artwork (hash, mime, width, height, byte_size)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![hash, mime, w, h, bytes.len() as i64],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO artwork_file (rel_path, hash, size, mtime_ms) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![rel_path, hash, size + size_off, mtime + mtime_off],
            )
            .unwrap();
        }
        host
    }

    fn db_path(&self) -> PathBuf {
        self.spiral.path().join("Library.db")
    }

    /// Registers `bytes` as the image `hash` at `Artwork/Albums/<name>`.
    fn add_image(&self, hash: &str, name: &str, bytes: &[u8], (w, h): (u32, u32)) {
        let rel_path = format!("Artwork/Albums/{name}");
        let path = self.spiral.path().join(&rel_path);
        fs::write(&path, bytes).unwrap();
        let (size, mtime) = stat(&path);
        let conn = rusqlite::Connection::open(self.db_path()).unwrap();
        conn.execute(
            "INSERT INTO artwork (hash, mime, width, height, byte_size)
             VALUES (?1, 'image/jpeg', ?2, ?3, ?4)",
            rusqlite::params![hash, w, h, bytes.len() as i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO artwork_file (rel_path, hash, size, mtime_ms) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![rel_path, hash, size, mtime],
        )
        .unwrap();
    }

    async fn router(&self) -> Router {
        self.router_with_cache(self.cache.path()).await
    }

    async fn router_with_cache(&self, cache_dir: &Path) -> Router {
        let library = SqliteHostLibrary::open(self.db_path(), self.spiral.path())
            .await
            .unwrap();
        router(HostApi::new(library, DevTokenAuth::new(TOKEN), cache_dir))
    }

    fn cache_files(&self) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(self.cache.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        names
    }
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(|v| v.to_str().unwrap())
    }

    fn json(&self) -> Value {
        assert_eq!(self.header("content-type"), Some("application/json"));
        serde_json::from_slice(&self.body).unwrap()
    }
}

async fn send(app: &Router, uri: &str, headers: &[(&str, &str)], token: bool) -> Reply {
    let mut request = Request::get(uri);
    if token {
        request = request.header("authorization", format!("Bearer {TOKEN}"));
    }
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    Reply {
        status,
        headers,
        body,
    }
}

async fn get(app: &Router, uri: &str) -> Reply {
    send(app, uri, &[], true).await
}

fn assert_not_found(reply: &Reply, what: &str) {
    assert_eq!(reply.status, StatusCode::NOT_FOUND, "{what}");
    assert_eq!(reply.json(), json!({ "error": "not found" }), "{what}");
}

fn audio_uri(id: &str) -> String {
    format!("/v1/tracks/{id}/audio")
}

fn decoded(reply: &Reply) -> DynamicImage {
    image::load_from_memory(&reply.body).unwrap()
}

#[tokio::test]
async fn audio_downloads_whole() {
    let host = Host::new();
    let app = host.router().await;
    let reply = get(&app, &audio_uri(IN_MUSIC)).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body, audio_bytes(1));
    assert_eq!(reply.header("accept-ranges"), Some("bytes"));
    assert_eq!(reply.header("content-length"), Some("10000"));
}

#[tokio::test]
async fn audio_answers_a_range_request() {
    let host = Host::new();
    let app = host.router().await;
    let reply = send(
        &app,
        &audio_uri(IN_MUSIC),
        &[("range", "bytes=1000-1999")],
        true,
    )
    .await;
    assert_eq!(reply.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(reply.header("content-range"), Some("bytes 1000-1999/10000"));
    assert_eq!(reply.body, audio_bytes(1)[1000..2000]);

    // A suffix range.
    let reply = send(&app, &audio_uri(IN_MUSIC), &[("range", "bytes=-10")], true).await;
    assert_eq!(reply.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(reply.body, audio_bytes(1)[9990..]);
}

#[tokio::test]
async fn audio_resolves_absolute_and_spiral_relative_roots() {
    let host = Host::new();
    let app = host.router().await;
    // Source 1 is stored as `Music`, relative to the Spiral folder.
    assert_eq!(get(&app, &audio_uri(IN_MUSIC)).await.body, audio_bytes(1));
    // Source 2 is stored as an absolute path outside it.
    let reply = get(&app, &audio_uri(IN_ABSOLUTE)).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body, audio_bytes(2));
}

#[tokio::test]
async fn audio_is_the_same_404_for_anything_it_wont_serve() {
    let host = Host::new();
    let app = host.router().await;
    let mut cases = vec![
        (UNKNOWN, "an unknown id"),
        (MISSING, "a file missing on disk"),
        (DOT_DOT, "a rel_path with .."),
        ("not-a-uuid", "a malformed id"),
    ];
    if cfg!(unix) {
        cases.push((SYMLINK_OUT, "a symlink out of the root"));
    }
    let mut bodies = Vec::new();
    for (id, what) in cases {
        let reply = get(&app, &audio_uri(id)).await;
        assert_not_found(&reply, what);
        let length = reply.header("content-length").map(str::to_owned);
        bodies.push((reply.body, length));
    }
    bodies.dedup();
    assert_eq!(bodies.len(), 1, "every 404 is byte for byte the same");
}

#[tokio::test]
async fn artwork_serves_the_original() {
    let host = Host::new();
    let app = host.router().await;
    let reply = get(&app, &format!("/v1/artwork/{SMALL}")).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(
        reply.body,
        fs::read(host.spiral.path().join("Artwork/Albums/small.jpg")).unwrap()
    );
    assert_eq!(reply.header("content-type"), Some("image/jpeg"));
    assert_eq!(reply.header("etag"), Some(&*format!("\"{SMALL}-orig\"")));
    assert_eq!(
        reply.header("cache-control"),
        Some("private, max-age=31536000, immutable")
    );
}

#[tokio::test]
async fn artwork_answers_304_to_a_matching_if_none_match() {
    let host = Host::new();
    let app = host.router().await;
    let uri = format!("/v1/artwork/{WIDE}?max=300");
    let first = get(&app, &uri).await;
    let etag = first.header("etag").unwrap().to_owned();
    assert_eq!(etag, format!("\"{WIDE}-300\""));

    for if_none_match in [
        etag.clone(),
        format!("W/{etag}"),
        format!("\"other\", {etag}"),
        "*".into(),
    ] {
        let reply = send(&app, &uri, &[("if-none-match", &if_none_match)], true).await;
        assert_eq!(reply.status, StatusCode::NOT_MODIFIED, "{if_none_match}");
        assert!(reply.body.is_empty());
        assert_eq!(reply.header("etag"), Some(&*etag));
        assert_eq!(
            reply.header("cache-control"),
            Some("private, max-age=31536000, immutable")
        );
    }

    // The original's tag doesn't match the resized image, and vice versa.
    let reply = send(
        &app,
        &uri,
        &[("if-none-match", &format!("\"{WIDE}-orig\""))],
        true,
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    let reply = send(
        &app,
        &format!("/v1/artwork/{WIDE}"),
        &[("if-none-match", &etag)],
        true,
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
}

#[tokio::test]
async fn artwork_whose_file_changed_or_left_artwork_is_404() {
    let host = Host::new();
    let app = host.router().await;
    for (hash, what) in [
        (WRONG_SIZE, "a size mismatch"),
        (WRONG_MTIME, "an mtime mismatch"),
        (OUTSIDE_ARTWORK, "a file outside Artwork/"),
        (UNKNOWN_HASH, "an unknown hash"),
    ] {
        assert_not_found(&get(&app, &format!("/v1/artwork/{hash}")).await, what);
    }
}

#[tokio::test]
async fn artwork_falls_back_to_an_intact_copy() {
    let host = Host::new();
    // A second, intact copy of WRONG_SIZE's image, sorted after the bad one.
    let path = host.spiral.path().join("Artwork/Albums/zz-copy.jpg");
    fs::copy(host.spiral.path().join("Artwork/Albums/size.jpg"), &path).unwrap();
    let (size, mtime) = stat(&path);
    rusqlite::Connection::open(host.db_path())
        .unwrap()
        .execute(
            "INSERT INTO artwork_file (rel_path, hash, size, mtime_ms) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["Artwork/Albums/zz-copy.jpg", WRONG_SIZE, size, mtime],
        )
        .unwrap();
    let app = host.router().await;
    let reply = get(&app, &format!("/v1/artwork/{WRONG_SIZE}")).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body, fs::read(&path).unwrap());
}

#[tokio::test]
async fn artwork_max_snaps_up_and_resizes() {
    let host = Host::new();
    let app = host.router().await;
    let reply = get(&app, &format!("/v1/artwork/{WIDE}?max=200")).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.header("etag"), Some(&*format!("\"{WIDE}-300\"")));
    // Opaque source: JPEG, aspect ratio kept, longer side 300.
    assert_eq!(reply.header("content-type"), Some("image/jpeg"));
    assert_eq!(image::guess_format(&reply.body).unwrap(), ImageFormat::Jpeg);
    let image = decoded(&reply);
    assert_eq!((image.width(), image.height()), (300, 150));

    // Anything above 1200 is 1200; the tall image is 1000, so that's the original.
    let reply = get(&app, &format!("/v1/artwork/{TALL_ALPHA}?max=5000")).await;
    assert_eq!(
        reply.header("etag"),
        Some(&*format!("\"{TALL_ALPHA}-orig\""))
    );

    // Alpha source: PNG with its alpha kept.
    let reply = get(&app, &format!("/v1/artwork/{TALL_ALPHA}?max=600")).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.header("content-type"), Some("image/png"));
    let image = decoded(&reply);
    assert_eq!((image.width(), image.height()), (300, 600));
    assert!(image.color().has_alpha());
}

#[tokio::test]
async fn artwork_is_never_upscaled() {
    let host = Host::new();
    let app = host.router().await;
    let original = fs::read(host.spiral.path().join("Artwork/Albums/small.jpg")).unwrap();
    for max in ["120", "1200"] {
        let reply = get(&app, &format!("/v1/artwork/{SMALL}?max={max}")).await;
        assert_eq!(reply.status, StatusCode::OK, "max={max}");
        assert_eq!(reply.body, original, "max={max}");
        assert_eq!(reply.header("etag"), Some(&*format!("\"{SMALL}-orig\"")));
    }
    assert!(host.cache_files().is_empty(), "nothing to cache");
}

#[tokio::test]
async fn resized_artwork_is_cached_outside_artwork_and_reused() {
    let host = Host::new();
    let app = host.router().await;
    let artwork_before = list_tree(&host.spiral.path().join("Artwork"));
    let uri = format!("/v1/artwork/{WIDE}?max=600");
    let first = get(&app, &uri).await;
    assert_eq!(first.status, StatusCode::OK);
    assert_eq!(host.cache_files(), [format!("{WIDE}-600.jpg")]);
    assert_eq!(
        list_tree(&host.spiral.path().join("Artwork")),
        artwork_before
    );

    // Replace the cached file: a reused cache entry is served as it is.
    let cached = host.cache.path().join(format!("{WIDE}-600.jpg"));
    let marker = encode(
        DynamicImage::ImageRgb8(RgbImage::from_pixel(600, 300, [1, 2, 3].into())),
        ImageFormat::Jpeg,
    );
    fs::write(&cached, &marker).unwrap();
    let second = get(&app, &uri).await;
    assert_eq!(second.status, StatusCode::OK);
    assert_eq!(second.body, marker);
    assert_eq!(host.cache_files(), [format!("{WIDE}-600.jpg")]);
}

fn list_tree(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            out.extend(list_tree(&path));
        } else {
            out.push(path);
        }
    }
    out.sort();
    out
}

#[tokio::test]
async fn artwork_rejects_a_bad_max_or_hash() {
    let host = Host::new();
    let app = host.router().await;
    for max in ["0", "", "-1", "abc", "1.5"] {
        let reply = get(&app, &format!("/v1/artwork/{WIDE}?max={max}")).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "max={max:?}");
        assert!(reply.json()["error"].is_string());
    }
    for hash in [
        "abc",
        &WIDE.to_uppercase(),
        &format!("{WIDE}0"),
        &WIDE[1..],
        &format!("{}g", &WIDE[1..]),
    ] {
        assert_not_found(&get(&app, &format!("/v1/artwork/{hash}")).await, hash);
    }
}

#[tokio::test]
async fn file_routes_need_a_token() {
    let host = Host::new();
    let app = host.router().await;
    for uri in [
        audio_uri(IN_MUSIC),
        audio_uri(UNKNOWN),
        format!("/v1/artwork/{WIDE}"),
        format!("/v1/artwork/{WIDE}?max=300"),
    ] {
        let reply = send(&app, &uri, &[("range", "bytes=0-10")], false).await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "{uri}");
        assert_eq!(reply.json(), json!({ "error": "unauthorized" }));
    }
    assert!(host.cache_files().is_empty());
}

#[tokio::test]
async fn audio_range_past_the_end_is_416_as_json() {
    let host = Host::new();
    let app = host.router().await;
    let reply = send(
        &app,
        &audio_uri(IN_MUSIC),
        &[("range", "bytes=20000-")],
        true,
    )
    .await;
    assert_eq!(reply.status, StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(reply.header("content-range"), Some("bytes */10000"));
    assert_eq!(reply.json(), json!({ "error": "Range Not Satisfiable" }));
}

/// Little-endian EXIF (TIFF) data with one tag: Orientation = 6, "rotate 90° clockwise".
const EXIF_ROTATE_90: [u8; 26] = [
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, // header, IFD at 8
    0x01, 0x00, // one entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, // 0x0112 SHORT 6
    0x00, 0x00, 0x00, 0x00, // no next IFD
];

#[tokio::test]
async fn resized_artwork_follows_exif_orientation() {
    use image::codecs::jpeg::JpegEncoder;
    use image::ImageEncoder;
    let host = Host::new();
    // Stored 400x200 (wide), shown 200x400 (tall) after the EXIF rotation.
    let pixels = RgbImage::from_pixel(400, 200, [90, 90, 90].into());
    let mut bytes = Vec::new();
    let mut encoder = JpegEncoder::new(&mut bytes);
    encoder.set_exif_metadata(EXIF_ROTATE_90.to_vec()).unwrap();
    encoder
        .write_image(&pixels, 400, 200, image::ExtendedColorType::Rgb8)
        .unwrap();
    let hash = "8".repeat(64);
    host.add_image(&hash, "rotated.jpg", &bytes, (400, 200));
    let app = host.router().await;

    let reply = get(&app, &format!("/v1/artwork/{hash}?max=120")).await;
    assert_eq!(reply.status, StatusCode::OK);
    let image = decoded(&reply);
    assert_eq!(
        (image.width(), image.height()),
        (60, 120),
        "upright, not sideways"
    );
}

#[tokio::test]
async fn opaque_rgba_artwork_resizes_to_jpeg() {
    let host = Host::new();
    let bytes = encode(
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(800, 800, [9, 9, 9, 255].into())),
        ImageFormat::Png,
    );
    let hash = "9".repeat(64);
    host.add_image(&hash, "opaque-rgba.png", &bytes, (800, 800));
    let app = host.router().await;

    let reply = get(&app, &format!("/v1/artwork/{hash}?max=300")).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.header("content-type"), Some("image/jpeg"));
    assert_eq!(image::guess_format(&reply.body).unwrap(), ImageFormat::Jpeg);
}

#[tokio::test]
async fn resized_artwork_is_served_when_the_cache_cant_be_written() {
    let host = Host::new();
    // A file where the cache folder should be: nothing can be written.
    let not_a_dir = host.cache.path().join("blocked");
    fs::write(&not_a_dir, b"").unwrap();
    let app = host.router_with_cache(&not_a_dir.join("cache")).await;

    let reply = get(&app, &format!("/v1/artwork/{WIDE}?max=300")).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.header("content-type"), Some("image/jpeg"));
    assert_eq!(reply.header("etag"), Some(&*format!("\"{WIDE}-300\"")));
    let image = decoded(&reply);
    assert_eq!((image.width(), image.height()), (300, 150));
}

#[tokio::test]
async fn stale_temp_files_are_swept_from_the_cache() {
    let host = Host::new();
    let stale = host.cache.path().join(format!(".{WIDE}-300.jpg.1-0.tmp"));
    let fresh = host.cache.path().join(format!(".{WIDE}-600.jpg.1-1.tmp"));
    let kept = host.cache.path().join(format!("{WIDE}-120.jpg"));
    for path in [&stale, &fresh, &kept] {
        fs::write(path, b"x").unwrap();
    }
    let two_hours_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(2 * 3600);
    for path in [&stale, &kept] {
        fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(two_hours_ago)
            .unwrap();
    }
    let _app = host.router().await;
    assert!(!stale.exists(), "an old temp file is removed");
    assert!(fresh.exists(), "a recent one may be a write in progress");
    assert!(kept.exists(), "cached images are left alone");
}
