//! Spiral pack registry library — HTTP API, DB, and object storage.

pub mod api;
pub mod config;
pub mod db;
pub mod models;
pub mod preview;
pub mod publish;
pub mod storage;

use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::Router;
use sqlx::SqlitePool;

use crate::config::Config;
use crate::storage::ObjectStorage;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: SqlitePool,
    pub storage: Arc<dyn ObjectStorage>,
}

pub fn app_router(state: AppState) -> Router {
    // Axum defaults to a 2 MiB body limit; raise it for .spk uploads (+ multipart overhead).
    let body_limit = (state.config.max_upload_bytes as usize).saturating_add(256 * 1024);
    api::router()
        .layer(DefaultBodyLimit::max(body_limit))
        .with_state(state)
}
