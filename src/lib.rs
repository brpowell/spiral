//! Spiral pack registry library — HTTP API, DB, and object storage.

pub mod api;
pub mod config;
pub mod db;
pub mod models;
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
    api::router().with_state(state)
}
