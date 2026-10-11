use std::time::Duration;

use anyhow::{Context, Result};
use spk_registry::config::{Config, StorageConfig};
use spk_registry::db;
use spk_registry::storage::build_storage;
use spk_registry::{app_router, AppState};
use tower_http::classify::ServerErrorsFailureClass;
use tower_http::trace::{DefaultMakeSpan, TraceLayer};
use tracing::Level;
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

    // Ops-oriented request logging: quiet on success; warn on odd 4xx; error on 5xx.
    // Skips routine 401/404/429 noise (auth + limiters log those themselves).
    // No headers/bodies — method + path come from the span.
    let trace = TraceLayer::new_for_http()
        .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
        .on_request(())
        .on_response(
            |response: &axum::http::Response<_>, latency: Duration, _span: &tracing::Span| {
                let status = response.status().as_u16();
                let latency_ms = latency.as_millis();
                if status >= 500 {
                    tracing::error!(status, latency_ms, "request");
                } else if status >= 400 && status != 401 && status != 404 && status != 429 {
                    tracing::warn!(status, latency_ms, "request");
                }
            },
        )
        .on_failure(
            |error: ServerErrorsFailureClass, latency: Duration, _span: &tracing::Span| {
                tracing::error!(error = %error, latency_ms = latency.as_millis(), "request failed");
            },
        );

    let app = app_router(state).layer(trace);
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
    eprintln!("  ➜  Admin       http://{}/rgad", config.bind_addr);
    eprintln!("  ➜  Protocol    v{protocol}");
    eprintln!("  ➜  Storage     {storage}");
    eprintln!("  ➜  Auth        {admin}");
    eprintln!();
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutdown signal received");
}
