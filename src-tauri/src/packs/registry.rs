//! Pack registry client: catalog fetch + integrity-checked download before install.

use super::install::{installed_pack_path, InstallPackResult};
use super::paths::{ensure_packs_ready, installed_packs_root};
use super::scan::{app_version, meets_min_app_version};
use crate::settings::{
    self, default_registries, effective_registry_url, registry_url_override,
    spiral_registry_source, RegistrySource, DEFAULT_REGISTRY_URL, LEGACY_DEFAULT_REGISTRY_URL,
    SPIRAL_REGISTRY_NAME,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::AppHandle;

const USER_AGENT: &str = concat!(
    "Spiral/",
    env!("CARGO_PKG_VERSION"),
    " (https://spiralpowered.com)"
);
const CATALOG_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);
const ASSET_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_CHUNK: usize = 64 * 1024;
/// Soft cap for registry pack-preview asset fetches (matches registry MAX_PREVIEW_BYTES scale).
const MAX_REGISTRY_ASSET_BYTES: u64 = 5 * 1024 * 1024;

static DOWNLOAD_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

pub const PACK_DOWNLOAD_CANCELLED_MESSAGE: &str = "Pack download cancelled";

/// Request that the in-flight registry download stop at the next chunk boundary.
pub fn request_download_cancel() {
    DOWNLOAD_CANCEL_REQUESTED.store(true, Ordering::SeqCst);
}

/// Clear a prior cancel request (call at the start of each download).
pub fn clear_download_cancel() {
    DOWNLOAD_CANCEL_REQUESTED.store(false, Ordering::SeqCst);
}

fn ensure_not_cancelled() -> Result<(), String> {
    if DOWNLOAD_CANCEL_REQUESTED.load(Ordering::SeqCst) {
        Err(PACK_DOWNLOAD_CANCELLED_MESSAGE.to_string())
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryContributionSummary {
    #[serde(rename = "type")]
    pub r#type: String,
    pub local_id: String,
    pub effective_id: String,
    pub name: String,
    #[serde(default)]
    pub author: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryVersionSummary {
    pub version: String,
    /// Display name from pack.json (empty on older registry rows).
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub min_app_version: Option<String>,
    pub contribution_types: Vec<String>,
    #[serde(default)]
    pub contributions: Vec<RegistryContributionSummary>,
    pub size_bytes: u64,
    pub sha256: String,
    pub published_at: String,
    #[serde(default)]
    pub preview_url: Option<String>,
}

/// Wire shape from `GET /v1/packs/:author/:pack/versions/:version` (includes README + CHANGELOG).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryVersionDetail {
    pub author_id: String,
    pub pack_id: String,
    pub version: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub min_app_version: Option<String>,
    pub contribution_types: Vec<String>,
    #[serde(default)]
    pub contributions: Vec<RegistryContributionSummary>,
    pub size_bytes: u64,
    pub sha256: String,
    pub published_at: String,
    #[serde(default)]
    pub preview_url: Option<String>,
    #[serde(default)]
    pub readme: Option<String>,
    #[serde(default)]
    pub changelog: Option<String>,
}

/// Wire shape from `GET /v1/packs/:author/:pack` (all published versions).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryPackDetail {
    pub author_id: String,
    pub pack_id: String,
    pub versions: Vec<RegistryVersionSummary>,
}

/// Pack detail tagged with which configured registry it came from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourcedRegistryPackDetail {
    pub registry_url: String,
    pub author_id: String,
    pub pack_id: String,
    pub versions: Vec<RegistryVersionSummary>,
}

/// Version detail tagged with which configured registry it came from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourcedRegistryVersionDetail {
    pub registry_url: String,
    pub author_id: String,
    pub pack_id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub min_app_version: Option<String>,
    pub contribution_types: Vec<String>,
    pub contributions: Vec<RegistryContributionSummary>,
    pub size_bytes: u64,
    pub sha256: String,
    pub published_at: String,
    #[serde(default)]
    pub preview_url: Option<String>,
    #[serde(default)]
    pub readme: Option<String>,
    #[serde(default)]
    pub changelog: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryPackSummary {
    pub author_id: String,
    pub pack_id: String,
    pub latest_version: RegistryVersionSummary,
}

/// Catalog row tagged with which configured registry it came from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourcedRegistryPackSummary {
    pub registry_url: String,
    pub author_id: String,
    pub pack_id: String,
    pub latest_version: RegistryVersionSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryFetchError {
    pub registry_url: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryPackList {
    pub packs: Vec<SourcedRegistryPackSummary>,
    #[serde(default)]
    pub errors: Vec<RegistryFetchError>,
}

/// Wire shape from `spk-registry` `GET /v1/packs` (no client provenance).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemotePackList {
    packs: Vec<RegistryPackSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackDownloadProgress {
    pub current: u64,
    pub total: u64,
}

/// Normalize a registry base URL (trim, strip trailing slash).
pub fn normalize_registry_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("registry URL is empty".into());
    }
    let without_slash = trimmed.trim_end_matches('/');
    if !(without_slash.starts_with("http://") || without_slash.starts_with("https://")) {
        return Err(format!(
            "registry URL must start with http:// or https://, got: {trimmed}"
        ));
    }
    Ok(without_slash.to_string())
}

fn is_official_registry_url(url: &str) -> bool {
    url == DEFAULT_REGISTRY_URL || url == effective_registry_url()
}

/// Rewrite a saved official URL (current or previous) to the env override when
/// set, otherwise to [`DEFAULT_REGISTRY_URL`].
fn apply_official_url_override(url: String) -> String {
    apply_official_url_override_with(url, registry_url_override())
}

fn apply_official_url_override_with(url: String, over: Option<String>) -> String {
    let is_official = url == DEFAULT_REGISTRY_URL || url == LEGACY_DEFAULT_REGISTRY_URL;
    if !is_official {
        return url;
    }
    over.unwrap_or_else(|| DEFAULT_REGISTRY_URL.to_string())
}

/// Official source only. Extra `registries[]` settings entries are ignored until
/// the multi-registry Preferences UI ships (`docs/impl/pack-registry-impl.md`).
pub fn configured_registries(_app: &AppHandle) -> Vec<RegistrySource> {
    default_registries()
}

/// Look up a configured registry by base URL.
pub fn find_registry_by_url(app: &AppHandle, registry_url: &str) -> Result<RegistrySource, String> {
    let url = normalize_registry_url(registry_url)?;
    configured_registries(app)
        .into_iter()
        .find(|r| r.url == url)
        .ok_or_else(|| format!("unknown registry URL \"{url}\""))
}

fn ensure_spiral_first(out: &mut Vec<RegistrySource>) {
    let spiral_pos = out.iter().position(|r| is_official_registry_url(&r.url));
    match spiral_pos {
        None => out.insert(0, spiral_registry_source()),
        Some(0) => {
            if let Some(spiral) = out.first_mut() {
                if spiral.name.trim().is_empty() {
                    spiral.name = SPIRAL_REGISTRY_NAME.to_string();
                }
            }
        }
        Some(pos) => {
            let mut spiral = out.remove(pos);
            if spiral.name.trim().is_empty() {
                spiral.name = SPIRAL_REGISTRY_NAME.to_string();
            }
            out.insert(0, spiral);
        }
    }
}

/// Validate + normalize a registries list for persistence.
pub fn validate_registries_for_save(
    registries: Vec<RegistrySource>,
) -> Result<Vec<RegistrySource>, String> {
    if registries.is_empty() {
        return Ok(default_registries());
    }

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();

    for entry in registries {
        let url = apply_official_url_override(normalize_registry_url(&entry.url)?);
        if !seen.insert(url.clone()) {
            return Err(format!("duplicate registry URL \"{url}\""));
        }
        let name = {
            let n = entry.name.trim();
            if n.is_empty() {
                if is_official_registry_url(&url) {
                    SPIRAL_REGISTRY_NAME.to_string()
                } else {
                    url.clone()
                }
            } else {
                n.to_string()
            }
        };
        out.push(RegistrySource { url, name });
    }

    ensure_spiral_first(&mut out);
    Ok(out)
}

fn join_url(base: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

/// Absolute download URL for a published pack version.
pub fn pack_download_url(
    registry_base: &str,
    author_id: &str,
    pack_id: &str,
    version: &str,
) -> String {
    join_url(
        registry_base,
        &format!("v1/packs/{author_id}/{pack_id}/versions/{version}/download"),
    )
}

fn http_client_with_redirect(
    timeout: Duration,
    redirect: reqwest::redirect::Policy,
) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(timeout)
        .redirect(redirect)
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

fn http_client(timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    http_client_with_redirect(timeout, reqwest::redirect::Policy::limited(10))
}

/// Asset fetches never follow redirects — only the allowlisted URL may be contacted.
fn asset_http_client(timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    http_client_with_redirect(timeout, reqwest::redirect::Policy::none())
}

/// Read a response body up to `max_bytes` (inclusive). Soft-fails if empty or over cap.
fn read_body_capped(mut body: impl Read, max_bytes: u64) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut buf = [0u8; 8 * 1024];
    loop {
        let n = body.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        if out.len() as u64 + n as u64 > max_bytes {
            return None;
        }
        out.extend_from_slice(&buf[..n]);
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// `GET {registry}/v1/packs` against one base URL (no provenance tagging).
pub fn fetch_pack_catalog_from_base(
    registry_base: &str,
    contribution_type: Option<&str>,
    author_id: Option<&str>,
) -> Result<Vec<RegistryPackSummary>, String> {
    let base = normalize_registry_url(registry_base)?;
    let url = join_url(&base, "v1/packs");
    let mut query: Vec<(&str, String)> = Vec::new();
    if let Some(ct) = contribution_type.map(str::trim).filter(|s| !s.is_empty()) {
        query.push(("contributionType", ct.to_string()));
    }
    if let Some(aid) = author_id.map(str::trim).filter(|s| !s.is_empty()) {
        query.push(("authorId", aid.to_string()));
    }

    let client = http_client(CATALOG_TIMEOUT)?;
    let mut request = client.get(&url);
    if !query.is_empty() {
        request = request.query(&query);
    }

    let response = request.send().map_err(|e| {
        if e.is_timeout() {
            format!("pack registry timed out ({base})")
        } else if e.is_connect() {
            format!("could not reach pack registry ({base})")
        } else {
            format!("pack registry request failed: {e}")
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(format!(
            "pack registry returned {status}{}",
            if snippet.is_empty() {
                String::new()
            } else {
                format!(": {snippet}")
            }
        ));
    }

    let remote: RemotePackList = response
        .json()
        .map_err(|e| format!("pack registry returned invalid catalog JSON: {e}"))?;
    Ok(remote.packs)
}

/// Fetch catalogs from every configured registry; tag rows with provenance.
///
/// Partial failure is non-fatal: successful sources still contribute packs, and
/// per-source errors are returned alongside so UI can show a friendly state.
pub fn fetch_pack_catalog(
    app: &AppHandle,
    contribution_type: Option<&str>,
    author_id: Option<&str>,
) -> RegistryPackList {
    let sources = configured_registries(app);
    let mut packs = Vec::new();
    let mut errors = Vec::new();

    if sources.is_empty() {
        errors.push(RegistryFetchError {
            registry_url: effective_registry_url(),
            error: "no pack registries configured".into(),
        });
        return RegistryPackList { packs, errors };
    }

    for source in sources {
        match fetch_pack_catalog_from_base(&source.url, contribution_type, author_id) {
            Ok(remote_packs) => {
                for pack in remote_packs {
                    packs.push(SourcedRegistryPackSummary {
                        registry_url: source.url.clone(),
                        author_id: pack.author_id,
                        pack_id: pack.pack_id,
                        latest_version: pack.latest_version,
                    });
                }
            }
            Err(error) => {
                errors.push(RegistryFetchError {
                    registry_url: source.url,
                    error,
                });
            }
        }
    }

    RegistryPackList { packs, errors }
}

/// `GET {registry}/v1/packs/{author}/{pack}` — all published (non-yanked) versions.
pub fn fetch_pack_detail(
    app: &AppHandle,
    registry_url: &str,
    author_id: &str,
    pack_id: &str,
) -> Result<SourcedRegistryPackDetail, String> {
    let source = find_registry_by_url(app, registry_url)?;
    let author_id = author_id.trim();
    let pack_id = pack_id.trim();
    if author_id.is_empty() || pack_id.is_empty() {
        return Err("authorId and packId are required".into());
    }

    let path = format!("v1/packs/{author_id}/{pack_id}");
    let url = join_url(&source.url, &path);
    let client = http_client(CATALOG_TIMEOUT)?;
    let response = client.get(&url).send().map_err(|e| {
        if e.is_timeout() {
            format!("pack registry timed out ({})", source.url)
        } else if e.is_connect() {
            format!("could not reach pack registry ({})", source.url)
        } else {
            format!("pack registry request failed: {e}")
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(format!(
            "pack registry returned {status}{}",
            if snippet.is_empty() {
                String::new()
            } else {
                format!(": {snippet}")
            }
        ));
    }

    let remote: RegistryPackDetail = response
        .json()
        .map_err(|e| format!("pack registry returned invalid pack detail JSON: {e}"))?;

    Ok(SourcedRegistryPackDetail {
        registry_url: source.url,
        author_id: remote.author_id,
        pack_id: remote.pack_id,
        versions: remote.versions,
    })
}

/// `GET {registry}/v1/packs/{author}/{pack}/versions/{version}` (use `latest` for tip).
pub fn fetch_pack_version_detail(
    app: &AppHandle,
    registry_url: &str,
    author_id: &str,
    pack_id: &str,
    version: &str,
) -> Result<SourcedRegistryVersionDetail, String> {
    let source = find_registry_by_url(app, registry_url)?;
    let author_id = author_id.trim();
    let pack_id = pack_id.trim();
    let version = version.trim();
    if author_id.is_empty() || pack_id.is_empty() || version.is_empty() {
        return Err("authorId, packId, and version are required".into());
    }

    let path = format!("v1/packs/{author_id}/{pack_id}/versions/{version}");
    let url = join_url(&source.url, &path);
    let client = http_client(CATALOG_TIMEOUT)?;
    let response = client.get(&url).send().map_err(|e| {
        if e.is_timeout() {
            format!("pack registry timed out ({})", source.url)
        } else if e.is_connect() {
            format!("could not reach pack registry ({})", source.url)
        } else {
            format!("pack registry request failed: {e}")
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(format!(
            "pack registry returned {status}{}",
            if snippet.is_empty() {
                String::new()
            } else {
                format!(": {snippet}")
            }
        ));
    }

    let remote: RegistryVersionDetail = response
        .json()
        .map_err(|e| format!("pack registry returned invalid version JSON: {e}"))?;

    Ok(SourcedRegistryVersionDetail {
        registry_url: source.url,
        author_id: remote.author_id,
        pack_id: remote.pack_id,
        version: remote.version,
        name: remote.name,
        description: remote.description,
        min_app_version: remote.min_app_version,
        contribution_types: remote.contribution_types,
        contributions: remote.contributions,
        size_bytes: remote.size_bytes,
        sha256: remote.sha256,
        published_at: remote.published_at,
        preview_url: remote.preview_url,
        readme: remote.readme,
        changelog: remote.changelog,
    })
}

/// Whether `authorId.packId`@`version` already exists under `packs/installed/`.
pub fn is_pack_installed(
    app: &AppHandle,
    author_id: &str,
    pack_id: &str,
    version: &str,
) -> Result<bool, String> {
    ensure_packs_ready(app)?;
    let installed = installed_packs_root(app)?;
    Ok(installed_pack_path(&installed, author_id, pack_id, version).is_dir())
}

pub fn pack_meets_min_app_version(min_app_version: Option<&str>) -> bool {
    match min_app_version.map(str::trim).filter(|s| !s.is_empty()) {
        None => true,
        Some(min) => meets_min_app_version(min, app_version()),
    }
}

/// Disk cache root for registry-fetched pack preview images.
pub fn registry_assets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings::app_data_dir(app)?.join("pack-registry-assets"))
}

/// Whether `absolute_url` is exactly `registry_base` or a path under it.
pub fn is_url_under_registry_base(absolute_url: &str, registry_base: &str) -> bool {
    let Ok(base) = normalize_registry_url(registry_base) else {
        return false;
    };
    let url = absolute_url.trim();
    if url.is_empty() {
        return false;
    }
    url == base || url.starts_with(&format!("{base}/"))
}

fn url_allowed_by_configured_registries(app: &AppHandle, absolute_url: &str) -> bool {
    configured_registries(app)
        .iter()
        .any(|r| is_url_under_registry_base(absolute_url, &r.url))
}

fn registry_asset_cache_key(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    hex::encode(hasher.finalize())[..16].to_string()
}

fn extension_from_content_type(content_type: &str) -> Option<&'static str> {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match mime.as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

fn find_cached_registry_asset(dir: &Path, key: &str) -> Option<PathBuf> {
    if !dir.is_dir() {
        return None;
    }
    for ext in ["png", "jpg", "webp", "gif"] {
        let path = dir.join(format!("{key}.{ext}"));
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

/// Fetch an image from an allowlisted registry URL into `{app_data}/pack-registry-assets/`.
///
/// Soft-fails (`None`) on network / type / size errors so catalog enrich stays non-fatal.
/// Does not follow redirects; body is streamed and aborted past [`MAX_REGISTRY_ASSET_BYTES`].
/// Shared primitive for pack preview images and other registry media.
pub fn fetch_and_cache_registry_asset(app: &AppHandle, absolute_url: &str) -> Option<PathBuf> {
    let url = absolute_url.trim();
    if url.is_empty() {
        return None;
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return None;
    }
    if !url_allowed_by_configured_registries(app, url) {
        return None;
    }

    let dir = registry_assets_dir(app).ok()?;
    let key = registry_asset_cache_key(url);
    if let Some(hit) = find_cached_registry_asset(&dir, &key) {
        return Some(hit);
    }

    let client = asset_http_client(ASSET_TIMEOUT).ok()?;
    let response = client.get(url).send().ok()?;
    if !response.status().is_success() {
        return None;
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let ext = extension_from_content_type(&content_type)?;

    if let Some(len) = response.content_length() {
        if len == 0 || len > MAX_REGISTRY_ASSET_BYTES {
            return None;
        }
    }

    let bytes = read_body_capped(response, MAX_REGISTRY_ASSET_BYTES)?;

    fs::create_dir_all(&dir).ok()?;
    let dest = dir.join(format!("{key}.{ext}"));
    let tmp = dir.join(format!("{key}.{ext}.tmp-{}", std::process::id()));
    if fs::write(&tmp, &bytes).is_err() {
        let _ = fs::remove_file(&tmp);
        return None;
    }
    if fs::rename(&tmp, &dest).is_err() {
        let _ = fs::remove_file(&tmp);
        return None;
    }
    Some(dest)
}

/// Resolve a catalog preview to a local cache path (for `convertFileSrc`).
///
/// `preview_url` may be absolute or relative to `registry_url`. Soft-fails to `None`.
pub fn resolve_registry_pack_preview(
    app: &AppHandle,
    registry_url: &str,
    preview_url: Option<&str>,
) -> Option<PathBuf> {
    let preview = preview_url.map(str::trim).filter(|s| !s.is_empty())?;
    let base = normalize_registry_url(registry_url).ok()?;
    find_registry_by_url(app, &base).ok()?;

    let absolute = if preview.starts_with("http://") || preview.starts_with("https://") {
        preview.to_string()
    } else {
        join_url(&base, preview)
    };

    fetch_and_cache_registry_asset(app, &absolute)
}

/// Download `.spk` bytes to a temp file, verify sha256, then install.
///
/// Integrity failure deletes the temp file and never touches `installed/`.
/// `catalog_size_bytes` is display metadata (uncompressed on-disk size); progress
/// uses HTTP `Content-Length` when present.
pub fn install_pack_from_url<F, P>(
    app: &AppHandle,
    download_url: &str,
    expected_sha256: &str,
    catalog_size_bytes: u64,
    on_progress: Option<&P>,
    validate_contribution: F,
) -> Result<InstallPackResult, String>
where
    F: Fn(&str, &Path, &Path) -> Result<(), String>,
    P: Fn(PackDownloadProgress) + ?Sized,
{
    clear_download_cancel();
    ensure_packs_ready(app)?;

    let expected_sha = expected_sha256.trim().to_ascii_lowercase();
    if expected_sha.len() != 64 || !expected_sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!(
            "invalid catalog sha256 (expected 64 hex chars): {expected_sha256}"
        ));
    }
    if catalog_size_bytes == 0 {
        return Err("catalog sizeBytes must be greater than zero".into());
    }

    let temp_path = download_spk_verified(download_url, &expected_sha, on_progress)?;

    let install_result =
        super::install::install_pack_from_path(app, &temp_path, validate_contribution);
    let _ = fs::remove_file(&temp_path);
    install_result
}

fn download_spk_verified<P>(
    download_url: &str,
    expected_sha256_lower: &str,
    on_progress: Option<&P>,
) -> Result<PathBuf, String>
where
    P: Fn(PackDownloadProgress) + ?Sized,
{
    let url = download_url.trim();
    if url.is_empty() {
        return Err("download URL is empty".into());
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!(
            "download URL must start with http:// or https://, got: {url}"
        ));
    }

    ensure_not_cancelled()?;

    let client = http_client(DOWNLOAD_TIMEOUT)?;
    let mut response = client.get(url).send().map_err(|e| {
        if e.is_timeout() {
            "pack download timed out".to_string()
        } else if e.is_connect() {
            format!("could not download pack ({url})")
        } else {
            format!("pack download failed: {e}")
        }
    })?;

    let status = response.status();
    if status.as_u16() == 410 {
        return Err("pack is no longer available (purged from the registry)".into());
    }
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(format!(
            "pack download returned {status}{}",
            if snippet.is_empty() {
                String::new()
            } else {
                format!(": {snippet}")
            }
        ));
    }

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_path = std::env::temp_dir().join(format!(
        "spiral-pack-dl-{}-{}.spk",
        std::process::id(),
        nanos
    ));

    let result = (|| {
        let mut file = File::create(&temp_path)
            .map_err(|e| format!("failed to create temp download file: {e}"))?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; DOWNLOAD_CHUNK];
        let mut downloaded: u64 = 0;
        let total = response.content_length().unwrap_or(0);

        if let Some(cb) = on_progress {
            cb(PackDownloadProgress { current: 0, total });
        }

        loop {
            ensure_not_cancelled()?;
            let n = response
                .read(&mut buf)
                .map_err(|e| format!("pack download read failed: {e}"))?;
            if n == 0 {
                break;
            }
            let next = downloaded.saturating_add(n as u64);
            if total > 0 && next > total {
                return Err(format!("downloaded pack exceeded Content-Length ({total})"));
            }
            file.write_all(&buf[..n])
                .map_err(|e| format!("failed to write temp download file: {e}"))?;
            hasher.update(&buf[..n]);
            downloaded = next;
            if let Some(cb) = on_progress {
                cb(PackDownloadProgress {
                    current: downloaded,
                    total,
                });
            }
        }

        file.flush()
            .map_err(|e| format!("failed to flush temp download file: {e}"))?;
        drop(file);

        if downloaded == 0 {
            return Err("downloaded pack was empty".into());
        }
        if total > 0 && downloaded != total {
            return Err(format!(
                "downloaded pack size mismatch (Content-Length {total}, got {downloaded})"
            ));
        }

        let actual_sha = hex::encode(hasher.finalize());
        if actual_sha != expected_sha256_lower {
            return Err("downloaded pack failed integrity check (sha256 mismatch)".to_string());
        }

        Ok(())
    })();

    if let Err(err) = result {
        let _ = fs::remove_file(&temp_path);
        return Err(err);
    }

    Ok(temp_path)
}

/// Verify sha256 of an already-downloaded file (unit-test helper surface).
#[cfg(test)]
pub(crate) fn verify_spk_file(path: &Path, expected_sha256: &str) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|e| format!("failed to read downloaded pack: {e}"))?;
    if bytes.is_empty() {
        return Err("downloaded pack was empty".into());
    }
    let actual = hex::encode(Sha256::digest(&bytes));
    let expected = expected_sha256.trim().to_ascii_lowercase();
    if actual != expected {
        return Err("downloaded pack failed integrity check (sha256 mismatch)".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::io::Write;

    fn write_temp_bytes(label: &str, bytes: &[u8]) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "spiral-registry-test-{label}-{}-{nanos}",
            std::process::id()
        ));
        let mut f = File::create(&path).unwrap();
        f.write_all(bytes).unwrap();
        path
    }

    #[test]
    fn normalize_registry_url_strips_slash_and_rejects_empty() {
        assert_eq!(
            normalize_registry_url(" https://example.com/registry/ ").unwrap(),
            "https://example.com/registry"
        );
        assert!(normalize_registry_url("").is_err());
        assert!(normalize_registry_url("ftp://nope").is_err());
    }

    #[test]
    fn validate_registries_rejects_duplicate_url_and_keeps_spiral_first() {
        let err = validate_registries_for_save(vec![
            RegistrySource {
                url: "https://a.example".into(),
                name: "A".into(),
            },
            RegistrySource {
                url: "https://a.example/".into(),
                name: "B".into(),
            },
        ])
        .unwrap_err();
        assert!(err.contains("duplicate"));

        let ok = validate_registries_for_save(vec![RegistrySource {
            url: "https://community.example/".into(),
            name: "Community".into(),
        }])
        .unwrap();
        assert_eq!(ok[0].url, effective_registry_url());
        assert_eq!(ok[1].url, "https://community.example");
        assert_eq!(ok[1].name, "Community");
    }

    #[test]
    fn apply_official_url_override_rewrites_default_when_override_set() {
        let over = "http://127.0.0.1:8787".to_string();
        assert_eq!(
            apply_official_url_override_with(DEFAULT_REGISTRY_URL.to_string(), Some(over.clone())),
            over
        );
        assert_eq!(
            apply_official_url_override_with("https://mirror.example".into(), Some(over.clone())),
            "https://mirror.example"
        );
        assert_eq!(
            apply_official_url_override_with(DEFAULT_REGISTRY_URL.to_string(), None),
            DEFAULT_REGISTRY_URL
        );
        assert_eq!(
            apply_official_url_override_with(LEGACY_DEFAULT_REGISTRY_URL.to_string(), None),
            DEFAULT_REGISTRY_URL
        );
        assert_eq!(
            apply_official_url_override_with(
                LEGACY_DEFAULT_REGISTRY_URL.to_string(),
                Some(over.clone())
            ),
            over
        );
    }

    #[test]
    fn is_url_under_registry_base_prefix_match() {
        let base = "http://127.0.0.1:8787";
        assert!(is_url_under_registry_base(
            "http://127.0.0.1:8787/v1/packs/a/b/versions/1.0.0/preview",
            base
        ));
        assert!(is_url_under_registry_base("http://127.0.0.1:8787", base));
        assert!(!is_url_under_registry_base(
            "http://127.0.0.1:8787.evil/preview",
            base
        ));
        assert!(!is_url_under_registry_base(
            "https://spk-registry.spiralpowered.com/v1/packs/a/b/versions/1.0.0/preview",
            base
        ));
    }

    #[test]
    fn extension_from_content_type_maps_image_mimes() {
        assert_eq!(extension_from_content_type("image/png"), Some("png"));
        assert_eq!(
            extension_from_content_type("image/jpeg; charset=binary"),
            Some("jpg")
        );
        assert_eq!(extension_from_content_type("image/webp"), Some("webp"));
        assert_eq!(extension_from_content_type("image/gif"), Some("gif"));
        assert_eq!(extension_from_content_type("application/json"), None);
        assert_eq!(extension_from_content_type(""), None);
    }

    #[test]
    fn read_body_capped_rejects_oversize_and_empty() {
        let ok = read_body_capped(&b"hello"[..], 10).unwrap();
        assert_eq!(ok, b"hello");
        assert!(read_body_capped(&b"hello world"[..], 5).is_none());
        assert!(read_body_capped(&b""[..], 10).is_none());
        assert!(read_body_capped(&b"x"[..], 0).is_none());
    }

    #[test]
    fn pack_download_url_joins_base() {
        assert_eq!(
            pack_download_url("https://reg.example", "spiral", "t3", "1.0.0"),
            "https://reg.example/v1/packs/spiral/t3/versions/1.0.0/download"
        );
    }

    #[test]
    fn verify_spk_file_accepts_matching_hash() {
        let bytes = b"fake-spk-bytes";
        let path = write_temp_bytes("ok", bytes);
        let sha = hex::encode(Sha256::digest(bytes));
        verify_spk_file(&path, &sha).unwrap();
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn verify_spk_file_rejects_tampered_bytes() {
        let bytes = b"fake-spk-bytes";
        let path = write_temp_bytes("bad", bytes);
        let sha = hex::encode(Sha256::digest(b"other"));
        let err = verify_spk_file(&path, &sha).unwrap_err();
        assert!(err.contains("sha256 mismatch"));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn verify_spk_file_rejects_empty() {
        let path = write_temp_bytes("empty", b"");
        let sha = hex::encode(Sha256::digest(b""));
        let err = verify_spk_file(&path, &sha).unwrap_err();
        assert!(err.contains("empty"));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn pack_meets_min_app_version_none_is_ok() {
        assert!(pack_meets_min_app_version(None));
        assert!(pack_meets_min_app_version(Some("")));
        assert!(pack_meets_min_app_version(Some("0.0.1")));
        assert!(!pack_meets_min_app_version(Some("999.0.0")));
    }

    #[test]
    fn cancel_flag_tripwire() {
        clear_download_cancel();
        assert!(ensure_not_cancelled().is_ok());
        request_download_cancel();
        assert_eq!(
            ensure_not_cancelled().unwrap_err(),
            PACK_DOWNLOAD_CANCELLED_MESSAGE
        );
        clear_download_cancel();
        assert!(ensure_not_cancelled().is_ok());
    }
}
