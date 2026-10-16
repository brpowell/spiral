//! Runtime configuration from environment variables.

use std::env;
use std::path::PathBuf;

use anyhow::{bail, Context, Result};

/// Wire protocol version spoken by this instance (`GET /v1/meta`).
pub const PROTOCOL_VERSION: u32 = 1;

/// Default max `.spk` upload size (50 MiB).
pub const DEFAULT_MAX_UPLOAD_BYTES: u64 = 50 * 1024 * 1024;

/// Default trusted proxy header for client IP (Fly today; override via `CLIENT_IP_HEADER`).
pub const DEFAULT_CLIENT_IP_HEADER: &str = "fly-client-ip";

/// Minimum `ADMIN_TOKEN` length when admin is enabled (empty still disables writes).
const MIN_ADMIN_TOKEN_BYTES: usize = 32;

#[derive(Clone)]
pub struct Config {
    pub bind_addr: String,
    pub instance_name: String,
    pub database_url: String,
    /// Apply pending schema migrations at startup (`AUTO_MIGRATE`, default true).
    pub auto_migrate: bool,
    pub storage: StorageConfig,
    /// Shared admin bearer token. Empty disables admin write endpoints.
    pub admin_token: String,
    pub max_upload_bytes: u64,
    /// Trusted proxy header for rate-limit keys (e.g. `fly-client-ip`, `cf-connecting-ip`).
    /// Empty means peer address only. Do not set this to `X-Forwarded-For`.
    pub client_ip_header: String,
}

impl std::fmt::Debug for Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Config")
            .field("bind_addr", &self.bind_addr)
            .field("instance_name", &self.instance_name)
            .field("database_url", &self.database_url)
            .field("auto_migrate", &self.auto_migrate)
            .field("storage", &self.storage)
            .field(
                "admin_token",
                &if self.admin_token.is_empty() {
                    "<empty>"
                } else {
                    "<redacted>"
                },
            )
            .field("max_upload_bytes", &self.max_upload_bytes)
            .field("client_ip_header", &self.client_ip_header)
            .finish()
    }
}

#[derive(Debug, Clone)]
pub enum StorageConfig {
    Local {
        root: PathBuf,
    },
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

        let auto_migrate = parse_bool_env("AUTO_MIGRATE", true)?;

        let admin_token = env::var("ADMIN_TOKEN").unwrap_or_default();
        let admin_token = admin_token.trim().to_string();
        validate_admin_token(&admin_token)?;

        let client_ip_header =
            env::var("CLIENT_IP_HEADER").unwrap_or_else(|_| DEFAULT_CLIENT_IP_HEADER.to_string());
        let client_ip_header = client_ip_header.trim().to_ascii_lowercase();
        validate_client_ip_header(&client_ip_header)?;

        Ok(Self {
            bind_addr: env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8787".to_string()),
            instance_name: env::var("INSTANCE_NAME")
                .unwrap_or_else(|_| "Spiral Pack Registry".to_string()),
            database_url,
            auto_migrate,
            storage,
            admin_token,
            max_upload_bytes,
            client_ip_header,
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

/// Boolean env var: `true`/`false`/`1`/`0` (case-insensitive); unset or empty uses `default`.
fn parse_bool_env(name: &str, default: bool) -> Result<bool> {
    match env::var(name) {
        Ok(raw) => parse_bool(name, &raw, default),
        Err(_) => Ok(default),
    }
}

fn parse_bool(name: &str, raw: &str, default: bool) -> Result<bool> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "" => Ok(default),
        "true" | "1" => Ok(true),
        "false" | "0" => Ok(false),
        other => bail!("{name} must be true or false, got {other:?}"),
    }
}

/// Empty means peer address only. A non-empty value must be a valid HTTP header name.
fn validate_client_ip_header(name: &str) -> Result<()> {
    if name.is_empty() {
        return Ok(());
    }
    axum::http::HeaderName::try_from(name)
        .map(|_| ())
        .with_context(|| format!("invalid CLIENT_IP_HEADER={name:?}"))
}

/// Empty token disables admin. A non-empty token must meet [`MIN_ADMIN_TOKEN_BYTES`].
fn validate_admin_token(token: &str) -> Result<()> {
    if token.is_empty() {
        return Ok(());
    }
    if token.len() < MIN_ADMIN_TOKEN_BYTES {
        bail!(
            "ADMIN_TOKEN must be at least {MIN_ADMIN_TOKEN_BYTES} bytes when set (empty disables admin); got {} bytes",
            token.len()
        );
    }
    Ok(())
}

fn sqlite_file_path(url: &str) -> Option<PathBuf> {
    let rest = url.strip_prefix("sqlite:")?;
    let path = rest.split('?').next()?;
    if path.is_empty() || path == ":memory:" {
        return None;
    }
    Some(PathBuf::from(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bool_env_parses_common_spellings() {
        assert!(parse_bool("X", "TRUE", false).unwrap());
        assert!(!parse_bool("X", "0", true).unwrap());
        assert!(parse_bool("X", "", true).unwrap());
        assert!(parse_bool("X", "maybe", true).is_err());
    }

    #[test]
    fn empty_admin_token_is_allowed() {
        validate_admin_token("").unwrap();
    }

    #[test]
    fn short_admin_token_is_rejected() {
        let err = validate_admin_token("dev-secret").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("32"), "{msg}");
        assert!(!msg.contains("dev-secret"), "{msg}");
    }

    #[test]
    fn long_enough_admin_token_is_accepted() {
        validate_admin_token(&"a".repeat(MIN_ADMIN_TOKEN_BYTES)).unwrap();
    }

    #[test]
    fn empty_client_ip_header_is_allowed() {
        validate_client_ip_header("").unwrap();
    }

    #[test]
    fn invalid_client_ip_header_is_rejected() {
        let err = validate_client_ip_header("not a header").unwrap_err();
        assert!(err.to_string().contains("CLIENT_IP_HEADER"), "{err}");
    }

    #[test]
    fn debug_redacts_admin_token() {
        let config = Config {
            bind_addr: "127.0.0.1:8787".into(),
            instance_name: "Test".into(),
            database_url: "sqlite::memory:".into(),
            auto_migrate: true,
            storage: StorageConfig::Local {
                root: PathBuf::from("data/objects"),
            },
            admin_token: "a".repeat(MIN_ADMIN_TOKEN_BYTES),
            max_upload_bytes: DEFAULT_MAX_UPLOAD_BYTES,
            client_ip_header: DEFAULT_CLIENT_IP_HEADER.into(),
        };
        let debug = format!("{config:?}");
        assert!(debug.contains("<redacted>"), "{debug}");
        assert!(
            !debug.contains(&"a".repeat(MIN_ADMIN_TOKEN_BYTES)),
            "{debug}"
        );
    }
}
