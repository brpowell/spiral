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

use crate::config::Config;
use crate::db::CatalogStore;
use crate::storage::ObjectStorage;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: Arc<dyn CatalogStore>,
    pub storage: Arc<dyn ObjectStorage>,
}

/// The public listener's router. With `ADMIN_BIND_ADDR` unset it also serves the admin panel
/// and API; with it set, those live only on [`admin_router`] and 404 here.
pub fn app_router(state: AppState) -> Router {
    let surface = public_surface(&state);
    build(state, surface, api::LimitClock::default())
}

/// [`app_router`] with the rate limiters' clock frozen, so a spent quota never refills. Lets
/// tests hit a per-minute limit however slowly they send requests.
#[doc(hidden)]
pub fn app_router_with_frozen_limits(state: AppState) -> Router {
    let surface = public_surface(&state);
    build(state, surface, api::LimitClock::frozen())
}

fn public_surface(state: &AppState) -> api::Surface {
    if state.config.admin_bind_addr.is_some() {
        api::Surface::Public
    } else {
        api::Surface::Combined
    }
}

/// The private admin listener's router: the panel, the admin API and preview images. Serve it on
/// `Config::admin_bind_addr`.
pub fn admin_router(state: AppState) -> Router {
    build(state, api::Surface::Admin, api::LimitClock::default())
}

fn build(state: AppState, surface: api::Surface, clock: api::LimitClock) -> Router {
    // Axum's 2 MiB default applies everywhere. Only the admin upload route raises it
    // for .spk uploads (+ multipart overhead).
    let upload_body_limit = (state.config.max_upload_bytes as usize).saturating_add(256 * 1024);
    let client_ip = api::ClientIpSource::new(&state.config.client_ip_header)
        .expect("client_ip_header validated at boot");
    api::router(
        upload_body_limit,
        client_ip,
        &state.config.admin_path,
        surface,
        clock,
    )
    .with_state(state)
}
