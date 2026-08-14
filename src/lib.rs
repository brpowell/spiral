//! Spiral pack registry library — HTTP API, DB, and object storage.

pub mod api;
pub mod config;
pub mod db;
pub mod models;
pub mod preview;
pub mod publish;
pub mod storage;

use std::sync::Arc;

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
    // Axum's 2 MiB default applies everywhere. Only POST /v1/rgad/packs raises it
    // for .spk uploads (+ multipart overhead).
    let upload_body_limit = (state.config.max_upload_bytes as usize).saturating_add(256 * 1024);
    let client_ip = api::ClientIpSource::new(&state.config.client_ip_header)
        .expect("client_ip_header validated at boot");
    api::router(upload_body_limit, client_ip).with_state(state)
}
