//! Security headers on every response. HSTS is left to the TLS terminator.

use axum::extract::Request;
use axum::http::{header, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;

const NOSNIFF: HeaderValue = HeaderValue::from_static("nosniff");
const REFERRER_POLICY: HeaderValue = HeaderValue::from_static("no-referrer");
const FRAME_DENY: HeaderValue = HeaderValue::from_static("DENY");

/// Admin HTML: same-origin assets + inline styles from the Preact SPA.
const CSP_HTML: HeaderValue = HeaderValue::from_static(
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'",
);

/// JSON, images, downloads: do not treat the response as an executable document.
const CSP_OTHER: HeaderValue = HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'");

pub(crate) async fn security_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let is_html = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|ct| ct.starts_with("text/html"));

    let headers = response.headers_mut();
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, NOSNIFF);
    headers.insert(header::REFERRER_POLICY, REFERRER_POLICY);
    headers.insert(header::X_FRAME_OPTIONS, FRAME_DENY);
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        if is_html { CSP_HTML } else { CSP_OTHER },
    );
    response
}
