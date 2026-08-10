use anyhow::{Context, Result};
use spk_registry::config::Config;
use spk_registry::db;
use spk_registry::storage::build_storage;
use spk_registry::{app_router, AppState};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config = Config::from_env()?;
    config.ensure_data_dirs()?;

    let db = db::connect(&config.database_url).await?;
    let storage = build_storage(&config.storage)?;

    let state = AppState {
        config: config.clone(),
        db,
        storage,
    };

    let app = app_router(state).layer(TraceLayer::new_for_http());
    let listener = tokio::net::TcpListener::bind(&config.bind_addr)
        .await
        .with_context(|| format!("bind {}", config.bind_addr))?;

    tracing::info!(
        "spk-registry listening on http://{} (protocol v{})",
        config.bind_addr,
        spk_registry::config::PROTOCOL_VERSION
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")?;

    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutdown signal received");
}
