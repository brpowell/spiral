//! HTTP API (`/v1/...`).

mod admin;
mod auth;
mod error;
mod meta;
mod packs;

use axum::Router;

use crate::AppState;

pub use error::{ApiError, ApiResult};

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(meta::router())
        .merge(packs::router())
        .merge(admin::router())
}
