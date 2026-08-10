//! Runtime configuration from environment variables.

use std::env;
use std::path::PathBuf;

use anyhow::{bail, Context, Result};

/// Wire protocol version spoken by this instance (`GET /v1/meta`).
pub const PROTOCOL_VERSION: u32 = 1;

/// Default max `.spk` upload size (50 MiB).
pub const DEFAULT_MAX_UPLOAD_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct Config {
    pub bind_addr: String,
    pub instance_name: String,
    pub database_url: String,
    pub storage: StorageConfig,
    /// Shared admin bearer token. Empty disables admin write endpoints.
    pub admin_token: String,
    pub max_upload_bytes: u64,
}

#[derive(Debug, Clone)]
pub enum StorageConfig {
    Local { root: PathBuf },
    /// Stub — not implemented in Phase 1.
    S3,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let database_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite:data/registry.db?mode=rwc".to_string());

        if database_url.starts_with("postgres") || database_url.starts_with("postgresql") {
            bail!(
                "Postgres is reserved for a later phase; set DATABASE_URL to a sqlite:… URL for now"
            );
        }

        let storage = match env::var("STORAGE_BACKEND")
            .unwrap_or_else(|_| "local".to_string())
            .to_ascii_lowercase()
            .as_str()
        {
            "local" => {
                let root = env::var("STORAGE_LOCAL_PATH")
                    .map(PathBuf::from)
                    .unwrap_or_else(|_| PathBuf::from("data/objects"));
                StorageConfig::Local { root }
            }
            "s3" => StorageConfig::S3,
            other => bail!("unknown STORAGE_BACKEND={other:?} (expected local or s3)"),
        };

        let max_upload_bytes = match env::var("MAX_UPLOAD_BYTES") {
            Ok(raw) => raw
                .parse::<u64>()
                .with_context(|| format!("parse MAX_UPLOAD_BYTES={raw:?}"))?,
            Err(_) => DEFAULT_MAX_UPLOAD_BYTES,
        };

        Ok(Self {
            bind_addr: env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8787".to_string()),
            instance_name: env::var("INSTANCE_NAME")
                .unwrap_or_else(|_| "Spiral Pack Registry".to_string()),
            database_url,
            storage,
            admin_token: env::var("ADMIN_TOKEN").unwrap_or_default(),
            max_upload_bytes,
        })
    }

    /// Ensure parent dirs exist for the default SQLite file URL.
    pub fn ensure_data_dirs(&self) -> Result<()> {
        if let Some(path) = sqlite_file_path(&self.database_url) {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .with_context(|| format!("create db dir {}", parent.display()))?;
            }
        }
        if let StorageConfig::Local { root } = &self.storage {
            std::fs::create_dir_all(root)
                .with_context(|| format!("create storage dir {}", root.display()))?;
        }
        Ok(())
    }

    pub fn admin_enabled(&self) -> bool {
        !self.admin_token.is_empty()
    }
}

fn sqlite_file_path(url: &str) -> Option<PathBuf> {
    let rest = url.strip_prefix("sqlite:")?;
    let path = rest.split('?').next()?;
    if path.is_empty() || path == ":memory:" {
        return None;
    }
    Some(PathBuf::from(path))
}
