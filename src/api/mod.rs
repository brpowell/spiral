//! HTTP API (`/v1/...`).

mod admin;
mod auth;
mod error;
mod headers;
mod meta;
mod packs;

use axum::middleware;
use axum::Router;

use crate::AppState;

pub use error::{ApiError, ApiResult};

pub fn router(upload_body_limit: usize) -> Router<AppState> {
    Router::new()
        .merge(meta::router())
        .merge(packs::router())
        .merge(admin::router(upload_body_limit))
        .layer(middleware::from_fn(headers::security_headers))
}
