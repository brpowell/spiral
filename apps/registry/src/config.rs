//! Runtime configuration from environment variables.

use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{bail, Context, Result};

use crate::db::{is_postgres_url, looks_pooled, DbOptions};

/// Wire protocol version spoken by this instance (`GET /v1/meta`).
pub const PROTOCOL_VERSION: u32 = 2;

/// Default mount point of the admin panel and its API (`ADMIN_PATH`).
pub const DEFAULT_ADMIN_PATH: &str = "/admin";

/// Default max `.spk` upload size (50 MiB).
pub const DEFAULT_MAX_UPLOAD_BYTES: u64 = 50 * 1024 * 1024;

/// Default trusted proxy header for client IP (Fly today; override via `CLIENT_IP_HEADER`).
pub const DEFAULT_CLIENT_IP_HEADER: &str = "fly-client-ip";

/// Minimum `ADMIN_TOKEN` length when admin is enabled (empty still disables writes).
const MIN_ADMIN_TOKEN_BYTES: usize = 32;

#[derive(Clone)]
pub struct Config {
    pub bind_addr: String,
    /// Second listener for the admin panel and API (`ADMIN_BIND_ADDR`). When set, they are served
    /// only there and 404 on `bind_addr`; when `None`, everything shares `bind_addr`.
    pub admin_bind_addr: Option<String>,
    pub instance_name: String,
    pub database_url: String,
    /// Direct connection used for migrations (`DATABASE_MIGRATE_URL`). A transaction-mode
    /// connection pooler cannot hold the advisory lock migrations take, so point this at the
    /// provider's direct (non-pooled) URL. Defaults to `database_url`.
    pub database_migrate_url: Option<String>,
    /// Pool, timeout and pooler settings for a Postgres `database_url`.
    pub db: DbOptions,
    /// Apply pending schema migrations at startup (`AUTO_MIGRATE`, default true).
    pub auto_migrate: bool,
    pub storage: StorageConfig,
    /// Shared admin bearer token. Empty disables admin write endpoints.
    pub admin_token: String,
    /// Where the admin panel is served (`ADMIN_PATH`, default `/admin`). The admin API lives at
    /// `<admin_path>/api`. Normalised: leading slash, no trailing slash.
    pub admin_path: String,
    pub max_upload_bytes: u64,
    /// Trusted proxy header for rate-limit keys (e.g. `fly-client-ip`, `cf-connecting-ip`).
    /// Empty means peer address only. Do not set this to `X-Forwarded-For`.
    pub client_ip_header: String,
}

impl std::fmt::Debug for Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Config")
            .field("bind_addr", &self.bind_addr)
            .field("admin_bind_addr", &self.admin_bind_addr)
            .field("instance_name", &self.instance_name)
            .field("database_url", &redact_url(&self.database_url))
            .field(
                "database_migrate_url",
                &self.database_migrate_url.as_deref().map(redact_url),
            )
            .field("db", &self.db)
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
            .field("admin_path", &self.admin_path)
            .field("max_upload_bytes", &self.max_upload_bytes)
            .field("client_ip_header", &self.client_ip_header)
            .finish()
    }
}

#[derive(Debug, Clone)]
pub enum StorageConfig {
    Local { root: PathBuf },
    S3(S3Config),
}

/// Settings for the S3-compatible backend (`STORAGE_BACKEND=s3`). Credentials are not here: they
/// come from the standard AWS environment or profile.
#[derive(Clone, PartialEq, Eq)]
pub struct S3Config {
    pub bucket: String,
    /// AWS region name; with a custom endpoint it is only passed through when signing.
    pub region: String,
    /// Custom endpoint for R2, Tigris, MinIO and other S3-compatible services.
    pub endpoint: Option<String>,
    /// Prepended to every object key, e.g. `registry/`. Empty or ending in `/`.
    pub key_prefix: String,
    /// Path-style addressing (`endpoint/bucket/key`); on by default with a custom endpoint.
    pub path_style: bool,
    /// Lifetime of the presigned download URLs the registry redirects to.
    pub presign_ttl_secs: u32,
}

impl std::fmt::Debug for S3Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("S3Config")
            .field("bucket", &self.bucket)
            .field("region", &self.region)
            .field("endpoint", &self.endpoint)
            .field("key_prefix", &self.key_prefix)
            .field("path_style", &self.path_style)
            .field("presign_ttl_secs", &self.presign_ttl_secs)
            .finish()
    }
}

/// Default lifetime of a presigned download URL.
const DEFAULT_PRESIGN_TTL_SECS: u32 = 600;

/// Hide the password in a database URL so config can be logged.
fn redact_url(url: &str) -> String {
    match (url.find("://"), url.rfind('@')) {
        (Some(scheme_end), Some(at)) if at > scheme_end => {
            let creds = &url[scheme_end + 3..at];
            match creds.split_once(':') {
                Some((user, _)) => {
                    format!("{}{user}:<redacted>{}", &url[..scheme_end + 3], &url[at..])
                }
                None => url.to_string(),
            }
        }
        _ => url.to_string(),
    }
}

fn read_s3_config() -> Result<S3Config> {
    let bucket = env::var("S3_BUCKET").unwrap_or_default().trim().to_string();
    if bucket.is_empty() {
        bail!("STORAGE_BACKEND=s3 requires S3_BUCKET");
    }
    let endpoint = env::var("S3_ENDPOINT")
        .ok()
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| !v.is_empty());
    if let Some(endpoint) = &endpoint {
        if !(endpoint.starts_with("https://") || endpoint.starts_with("http://")) {
            bail!("S3_ENDPOINT must start with http:// or https://, got {endpoint:?}");
        }
    }
    let region = env::var("S3_REGION")
        .or_else(|_| env::var("AWS_REGION"))
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "us-east-1".to_string());
    let key_prefix = normalize_key_prefix(&env::var("S3_KEY_PREFIX").unwrap_or_default())?;
    let path_style = parse_bool_env("S3_PATH_STYLE", endpoint.is_some())?;
    let presign_ttl_secs = match env::var("S3_PRESIGN_TTL_SECS") {
        Ok(raw) if !raw.trim().is_empty() => {
            let ttl = raw
                .trim()
                .parse::<u32>()
                .with_context(|| format!("parse S3_PRESIGN_TTL_SECS={raw:?}"))?;
            if !(1..=604_800).contains(&ttl) {
                bail!("S3_PRESIGN_TTL_SECS must be between 1 and 604800 (7 days), got {ttl}");
            }
            ttl
        }
        _ => DEFAULT_PRESIGN_TTL_SECS,
    };
    Ok(S3Config {
        bucket,
        region,
        endpoint,
        key_prefix,
        path_style,
        presign_ttl_secs,
    })
}

/// A key prefix is empty or a relative path ending in `/` (added if missing).
fn normalize_key_prefix(raw: &str) -> Result<String> {
    let trimmed = raw.trim().trim_start_matches('/');
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if trimmed.contains('\0') || trimmed.split('/').any(|seg| seg == "." || seg == "..") {
        bail!("S3_KEY_PREFIX must not contain '.' or '..' segments, got {raw:?}");
    }
    Ok(format!("{}/", trimmed.trim_end_matches('/')))
}

fn read_db_options(database_url: &str) -> Result<DbOptions> {
    let mut db = DbOptions::default();
    if let Ok(raw) = env::var("DB_MAX_CONNECTIONS") {
        if !raw.trim().is_empty() {
            db.max_connections = raw
                .trim()
                .parse::<u32>()
                .ok()
                .filter(|n| (1..=100).contains(n))
                .with_context(|| {
                    format!("DB_MAX_CONNECTIONS must be between 1 and 100, got {raw:?}")
                })?;
        }
    }
    if let Ok(raw) = env::var("DB_ACQUIRE_TIMEOUT_SECS") {
        if !raw.trim().is_empty() {
            let secs = raw
                .trim()
                .parse::<u64>()
                .ok()
                .filter(|n| (1..=300).contains(n))
                .with_context(|| {
                    format!("DB_ACQUIRE_TIMEOUT_SECS must be between 1 and 300, got {raw:?}")
                })?;
            db.acquire_timeout = Duration::from_secs(secs);
        }
    }
    db.pooler = parse_bool_env("DB_POOLER", looks_pooled(database_url))?;
    Ok(db)
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let database_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite:data/registry.db?mode=rwc".to_string());

        validate_database_url("DATABASE_URL", &database_url)?;
        let database_migrate_url = env::var("DATABASE_MIGRATE_URL")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        if let Some(url) = &database_migrate_url {
            validate_database_url("DATABASE_MIGRATE_URL", url)?;
        }
        let db = read_db_options(&database_url)?;

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
            "s3" => StorageConfig::S3(read_s3_config()?),
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

        let admin_path = normalize_admin_path(&env::var("ADMIN_PATH").unwrap_or_default())?;

        let client_ip_header =
            env::var("CLIENT_IP_HEADER").unwrap_or_else(|_| DEFAULT_CLIENT_IP_HEADER.to_string());
        let client_ip_header = client_ip_header.trim().to_ascii_lowercase();
        validate_client_ip_header(&client_ip_header)?;

        let bind_addr = env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8787".to_string());
        let admin_bind_addr =
            parse_admin_bind_addr(&env::var("ADMIN_BIND_ADDR").unwrap_or_default(), &bind_addr)?;

        Ok(Self {
            bind_addr,
            admin_bind_addr,
            instance_name: env::var("INSTANCE_NAME")
                .unwrap_or_else(|_| "Spiral Registry".to_string()),
            database_url,
            database_migrate_url,
            db,
            auto_migrate,
            storage,
            admin_token,
            admin_path,
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

/// `sqlite:` and `postgres://` URLs are supported.
fn validate_database_url(name: &str, url: &str) -> Result<()> {
    if url.starts_with("sqlite:") || is_postgres_url(url) {
        return Ok(());
    }
    bail!("{name} must be a sqlite:… or postgres://… URL");
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

/// Validate `ADMIN_BIND_ADDR`. Empty means unset (one listener). Otherwise it must be a socket
/// address (`[::]:8081`, `127.0.0.1:9000`) and must not be the same as `bind_addr`.
pub fn parse_admin_bind_addr(raw: &str, bind_addr: &str) -> Result<Option<String>> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let admin: SocketAddr = raw.parse().with_context(|| {
        format!("ADMIN_BIND_ADDR={raw:?} is not a socket address like \"[::]:8081\" or \"127.0.0.1:8081\"")
    })?;
    let same = raw == bind_addr.trim()
        || bind_addr
            .trim()
            .parse::<SocketAddr>()
            .is_ok_and(|public| public == admin);
    if same {
        bail!("ADMIN_BIND_ADDR must differ from BIND_ADDR ({bind_addr}); the admin listener is a separate port");
    }
    Ok(Some(raw.to_string()))
}

/// Validate and normalise `ADMIN_PATH`. Empty means the default. The path must start with `/`,
/// is stored without a trailing slash, and may not be `/` or live under `/v1` (the API prefix).
/// Segments are limited to letters, digits, `-`, `_` and `.` so the value is safe to embed in
/// routes and HTML.
pub fn normalize_admin_path(raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_ADMIN_PATH.to_string());
    }
    if !trimmed.starts_with('/') {
        bail!("ADMIN_PATH must start with '/', got {trimmed:?}");
    }
    let path = trimmed.trim_end_matches('/');
    if path.is_empty() {
        bail!("ADMIN_PATH cannot be '/': the admin panel needs its own prefix");
    }
    for segment in path[1..].split('/') {
        let ok = !segment.is_empty()
            && segment != "."
            && segment != ".."
            && segment
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
        if !ok {
            bail!(
                "ADMIN_PATH segment {segment:?} is invalid (use letters, digits, '-', '_' or '.')"
            );
        }
    }
    if path == "/v1" || path.starts_with("/v1/") {
        bail!("ADMIN_PATH cannot be under /v1, which is reserved for the API");
    }
    Ok(path.to_string())
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
    fn admin_path_defaults_and_normalises() {
        assert_eq!(normalize_admin_path("").unwrap(), "/admin");
        assert_eq!(normalize_admin_path("  ").unwrap(), "/admin");
        assert_eq!(normalize_admin_path("/ops/").unwrap(), "/ops");
        assert_eq!(normalize_admin_path("/a-b_c.d/e2").unwrap(), "/a-b_c.d/e2");
    }

    #[test]
    fn admin_path_rejects_unsafe_values() {
        for bad in [
            "admin",
            "/",
            "//",
            "/a//b",
            "/a/../b",
            "/v1",
            "/v1/admin",
            "/a b",
            "/a{b}",
            "/a?b",
            "/<x>",
            "/\"x\"",
        ] {
            assert!(
                normalize_admin_path(bad).is_err(),
                "{bad:?} should be rejected"
            );
        }
        // Only the exact /v1 prefix is reserved.
        assert_eq!(normalize_admin_path("/v10").unwrap(), "/v10");
    }

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
    fn admin_bind_addr_unset_or_empty_means_one_listener() {
        assert_eq!(parse_admin_bind_addr("", "0.0.0.0:8080").unwrap(), None);
        assert_eq!(parse_admin_bind_addr("  ", "0.0.0.0:8080").unwrap(), None);
    }

    #[test]
    fn admin_bind_addr_accepts_socket_addresses() {
        assert_eq!(
            parse_admin_bind_addr(" [::]:8081 ", "0.0.0.0:8080").unwrap(),
            Some("[::]:8081".to_string())
        );
        assert!(parse_admin_bind_addr("127.0.0.1:9000", "127.0.0.1:8787").is_ok());
    }

    #[test]
    fn admin_bind_addr_rejects_garbage_and_the_public_address() {
        for bad in ["8081", "localhost", "[::]", "host:port"] {
            let err = parse_admin_bind_addr(bad, "0.0.0.0:8080").unwrap_err();
            assert!(err.to_string().contains("ADMIN_BIND_ADDR"), "{bad}: {err}");
        }
        let err = parse_admin_bind_addr("0.0.0.0:8080", "0.0.0.0:8080").unwrap_err();
        assert!(err.to_string().contains("must differ"), "{err}");
        // Same address written differently still counts.
        assert!(parse_admin_bind_addr("[::]:8080", "[0:0:0:0:0:0:0:0]:8080").is_err());
    }

    #[test]
    fn debug_redacts_admin_token() {
        let config = Config {
            bind_addr: "127.0.0.1:8787".into(),
            admin_bind_addr: None,
            instance_name: "Test".into(),
            database_url: "sqlite::memory:".into(),
            database_migrate_url: None,
            db: DbOptions::default(),
            auto_migrate: true,
            storage: StorageConfig::Local {
                root: PathBuf::from("data/objects"),
            },
            admin_token: "a".repeat(MIN_ADMIN_TOKEN_BYTES),
            admin_path: DEFAULT_ADMIN_PATH.into(),
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
