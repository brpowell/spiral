//! Serve the Preact admin SPA from `admin/dist` (embedded at compile time).

use axum::extract::State;
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

use crate::AppState;

#[derive(Embed)]
#[folder = "admin/dist/"]
struct AdminAssets;

pub async fn index(State(state): State<AppState>) -> Response {
    index_response(&state.config.admin_path)
}

/// Static assets under `<admin_path>/*`, with SPA fallback to `index.html`.
pub async fn static_file(State(state): State<AppState>, uri: Uri) -> Response {
    let prefix = format!("{}/", state.config.admin_path);
    let path = uri
        .path()
        .strip_prefix(prefix.as_str())
        .unwrap_or("")
        .trim_start_matches('/');
    if path.is_empty() || path == "index.html" {
        return index_response(&state.config.admin_path);
    }
    if AdminAssets::get(path).is_some() {
        return asset_response(path);
    }
    // Client-side routes (`<admin_path>/items/...`) fall back to the shell.
    index_response(&state.config.admin_path)
}

/// The bundle is built with relative asset URLs; the server tells it where it is mounted.
/// `<base href>` resolves those URLs, and the meta tag gives the SPA its router scope and API
/// prefix without an inline script (the CSP forbids those).
fn index_response(admin_path: &str) -> Response {
    let Some(file) = AdminAssets::get("index.html") else {
        return missing_bundle();
    };
    let html = String::from_utf8_lossy(&file.data).replacen(
        "<head>",
        &format!(
            "<head>\n  <base href=\"{admin_path}/\" />\n  <meta name=\"admin-base\" content=\"{admin_path}\" />"
        ),
        1,
    );
    (
        [
            (header::CONTENT_TYPE, content_type("index.html")),
            (header::CACHE_CONTROL, cache_control("index.html")),
        ],
        html,
    )
        .into_response()
}

fn missing_bundle() -> Response {
    (
        StatusCode::NOT_FOUND,
        "admin asset missing — rebuild admin/dist",
    )
        .into_response()
}

fn asset_response(path: &str) -> Response {
    match AdminAssets::get(path) {
        Some(file) => {
            let mime = content_type(path);
            (
                [
                    (header::CONTENT_TYPE, mime),
                    (header::CACHE_CONTROL, cache_control(path)),
                ],
                file.data,
            )
                .into_response()
        }
        None => missing_bundle(),
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
