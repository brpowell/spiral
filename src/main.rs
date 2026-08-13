use anyhow::{Context, Result};
use spk_registry::config::{Config, StorageConfig};
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

    print_startup_banner(&config);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")?;

    Ok(())
}

fn print_startup_banner(config: &Config) {
    let version = env!("CARGO_PKG_VERSION");
    let protocol = spk_registry::config::PROTOCOL_VERSION;
    let storage = match &config.storage {
        StorageConfig::Local { root } => format!("local · {}", root.display()),
        StorageConfig::S3 => "s3".to_string(),
    };
    let admin = if config.admin_enabled() {
        "enabled"
    } else {
        "disabled (set ADMIN_TOKEN)"
    };

    // Printed outside tracing so the banner isn't prefixed with timestamps.
    eprintln!();
    eprintln!("  spk-registry  v{version}");
    eprintln!("  {}", config.instance_name);
    eprintln!();
    eprintln!("  ➜  Listening   http://{}", config.bind_addr);
    eprintln!("  ➜  Admin       http://{}/admin", config.bind_addr);
    eprintln!("  ➜  Protocol    v{protocol}");
    eprintln!("  ➜  Storage     {storage}");
    eprintln!("  ➜  Auth        {admin}");
    eprintln!();
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutdown signal received");
}
