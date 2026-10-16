//! HTTP API (`/v1/...`).

mod admin;
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

pub fn router(upload_body_limit: usize, client_ip: ClientIpSource) -> Router<AppState> {
    let admin_api = admin::api_router(upload_body_limit).layer(middleware::from_fn_with_state(
        limit::RateLimit::new(limit::ADMIN_REQUESTS_PER_MINUTE, client_ip.clone()),
        limit::rate_limit,
    ));

    let catalog = Router::new()
        .merge(meta::router())
        .merge(items::catalog_router())
        .layer(middleware::from_fn_with_state(
            limit::RateLimit::new(limit::CATALOG_REQUESTS_PER_MINUTE, client_ip.clone()),
            limit::rate_limit,
        ));

    let downloads = items::download_router().layer(middleware::from_fn_with_state(
        limit::DownloadLimit::new(limit::MAX_CONCURRENT_DOWNLOADS_PER_IP, client_ip),
        limit::download_concurrency,
    ));

    Router::new()
        .merge(admin_api)
        .merge(downloads)
        .merge(catalog)
        .merge(admin::panel_router())
        .layer(middleware::from_fn(headers::security_headers))
}
