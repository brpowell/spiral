//! HTTP API (`/v1/...`).

mod admin;
mod audit;
mod auth;
mod error;
mod headers;
mod items;
mod limit;
mod meta;

use axum::middleware;
use axum::Router;

use crate::AppState;

pub use error::{ApiError, ApiResult};
pub(crate) use limit::ClientIpSource;

/// Which routes a listener serves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Surface {
    /// Everything on one listener (no `ADMIN_BIND_ADDR`).
    Combined,
    /// Only the public `/v1` routes.
    Public,
    /// Only the admin panel and API (plus the preview route the panel's thumbnails use).
    Admin,
}

pub fn router(
    upload_body_limit: usize,
    client_ip: ClientIpSource,
    admin_path: &str,
    surface: Surface,
) -> Router<AppState> {
    let admin_api = admin::api_router(upload_body_limit, admin_path)
        .layer(middleware::from_fn_with_state(
            limit::RateLimit::new(limit::ADMIN_REQUESTS_PER_MINUTE, client_ip.clone()),
            limit::rate_limit,
        ))
        .layer(middleware::from_fn_with_state(
            client_ip.clone(),
            limit::attach_client_ip,
        ));

    let mut catalog = Router::new();
    if surface != Surface::Admin {
        catalog = catalog.merge(meta::router()).merge(items::catalog_router());
    }
    let catalog = catalog
        .merge(items::preview_router())
        .layer(middleware::from_fn_with_state(
            limit::RateLimit::new(limit::CATALOG_REQUESTS_PER_MINUTE, client_ip.clone()),
            limit::rate_limit,
        ));

    let downloads = items::download_router().layer(middleware::from_fn_with_state(
        limit::DownloadLimit::new(limit::MAX_CONCURRENT_DOWNLOADS_PER_IP, client_ip),
        limit::download_concurrency,
    ));

    let mut app = Router::new().merge(catalog);
    if surface != Surface::Admin {
        app = app.merge(downloads);
    }
    if surface != Surface::Public {
        app = app.merge(admin_api).merge(admin::panel_router(admin_path));
    }
    app.layer(middleware::from_fn(headers::security_headers))
}
