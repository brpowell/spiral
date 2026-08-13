//! Serve the Preact admin SPA from `admin/dist` (embedded at compile time).

use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "admin/dist/"]
struct AdminAssets;

pub async fn index() -> Response {
    asset_response("index.html")
}

/// Static assets under `/rgad/*`, with SPA fallback to `index.html`.
pub async fn static_file(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches("/rgad/");
    let path = path.trim_start_matches('/');
    if path.is_empty() {
        return asset_response("index.html");
    }
    if AdminAssets::get(path).is_some() {
        return asset_response(path);
    }
    // Client-side routes (`/rgad/packs/...`) fall back to the shell.
    asset_response("index.html")
}

fn asset_response(path: &str) -> Response {
    match AdminAssets::get(path) {
        Some(file) => {
            let mime = content_type(path);
            (
                [(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, cache_control(path))],
                file.data,
            )
                .into_response()
        }
        None => (StatusCode::NOT_FOUND, "admin asset missing — rebuild admin/dist").into_response(),
    }
}

fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next() {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("woff2") => "font/woff2",
        Some("map") => "application/json",
        _ => "application/octet-stream",
    }
}

fn cache_control(path: &str) -> &'static str {
    if path == "index.html" || path.ends_with(".html") {
        "no-cache"
    } else {
        // Vite hashes asset filenames.
        "public, max-age=31536000, immutable"
    }
}
