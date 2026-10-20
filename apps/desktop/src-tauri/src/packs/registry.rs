//! Item registry client: catalog fetch, update checks, and integrity-checked download before
//! install. Speaks the `/v1/items` API of `spk-registry`.

use super::install::{install_item_from_path_expecting, ExpectedItem, InstallItemResult};
use super::paths::ensure_packs_ready;
use super::scan::{app_version, list_installed_items, meets_min_app_version, version_cmp};
use super::{is_kebab_slug, item_type_folder};
use crate::settings::{
    self, default_registries, effective_registry_url, registry_url_override,
    spiral_registry_source, RegistrySource, DEFAULT_REGISTRY_URL, LEGACY_DEFAULT_REGISTRY_URL,
    SPIRAL_REGISTRY_NAME,
};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::time::Duration;
use tauri::AppHandle;

const CATALOG_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);
const ASSET_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_CHUNK: usize = 64 * 1024;
/// Soft cap for registry preview asset fetches (matches registry MAX_PREVIEW_BYTES scale).
const MAX_REGISTRY_ASSET_BYTES: u64 = 5 * 1024 * 1024;

static DOWNLOAD_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

pub const DOWNLOAD_CANCELLED_MESSAGE: &str = "Item download cancelled";

/// Request that the in-flight registry download stop at the next chunk boundary.
pub fn request_download_cancel() {
    DOWNLOAD_CANCEL_REQUESTED.store(true, AtomicOrdering::SeqCst);
}

/// Clear a prior cancel request (call at the start of each download).
pub fn clear_download_cancel() {
    DOWNLOAD_CANCEL_REQUESTED.store(false, AtomicOrdering::SeqCst);
}

fn ensure_not_cancelled() -> Result<(), String> {
    if DOWNLOAD_CANCEL_REQUESTED.load(AtomicOrdering::SeqCst) {
        Err(DOWNLOAD_CANCELLED_MESSAGE.to_string())
    } else {
        Ok(())
    }
}

/// Most installed items sent in one update-check request (the registry's cap).
const UPDATE_CHECK_BATCH: usize = 200;

/// One published version, as listed in the catalog.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryVersionSummary {
    pub version: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub min_app_version: Option<String>,
    /// Uncompressed on-disk size of the item (not the `.spk` archive length).
    pub size_bytes: u64,
    pub sha256: String,
    pub published_at: String,
    #[serde(default)]
    pub preview_url: Option<String>,
}

/// Catalog row: one item and its newest version. Wire shape of `GET /v1/items`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryItemSummary {
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
    pub effective_id: String,
    pub latest_version: RegistryVersionSummary,
}

/// Catalog row tagged with which configured registry it came from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourcedRegistryItemSummary {
    pub registry_url: String,
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
    pub effective_id: String,
    pub latest_version: RegistryVersionSummary,
}

/// An item with all of its published versions (`GET /v1/items/:publisher/:type/:id`).
/// `registry_url` is not on the wire; the client fills it in.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryItemDetail {
    #[serde(default)]
    pub registry_url: String,
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
    pub effective_id: String,
    /// Newest first.
    pub versions: Vec<RegistryVersionSummary>,
}

/// One version with its README and CHANGELOG (`.../versions/:version`).
/// `registry_url` is not on the wire; the client fills it in.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryVersionDetail {
    #[serde(default)]
    pub registry_url: String,
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
    pub effective_id: String,
    #[serde(flatten)]
    pub version: RegistryVersionSummary,
    #[serde(default)]
    pub readme: Option<String>,
    #[serde(default)]
    pub changelog: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryFetchError {
    pub registry_url: String,
    pub error: String,
}

/// Query for `GET /v1/items`; every field is optional.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemCatalogQuery {
    /// Item types to include; empty means every type.
    #[serde(default)]
    pub item_types: Vec<String>,
    pub q: Option<String>,
    pub publisher_id: Option<String>,
    /// `name`, `newest` or `size`; the registry's default (`name`) when absent.
    pub sort: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

/// Wire shape of `GET /v1/items` (no client provenance).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteItemList {
    pub items: Vec<RegistryItemSummary>,
    #[serde(default)]
    pub total: usize,
}

/// Catalog across every configured registry. `total` counts matches before paging.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryItemList {
    pub items: Vec<SourcedRegistryItemSummary>,
    pub total: usize,
    #[serde(default)]
    pub errors: Vec<RegistryFetchError>,
}

/// An installed item, as sent in an update check.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledItemRef {
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
    pub version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckBody<'a> {
    app_version: &'a str,
    items: &'a [InstalledItemRef],
}

/// One entry of the registry's update-check response.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteItemUpdate {
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
    pub latest: RegistryVersionSummary,
}

#[derive(Debug, Clone, Deserialize)]
struct RemoteUpdateCheck {
    updates: Vec<RemoteItemUpdate>,
}

/// A newer, app-compatible version of an installed item.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryItemUpdate {
    pub registry_url: String,
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
    pub effective_id: String,
    pub installed_version: String,
    pub latest: RegistryVersionSummary,
}

/// Result of checking every configured registry; unreachable ones land in `errors`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ItemUpdateCheck {
    pub updates: Vec<RegistryItemUpdate>,
    #[serde(default)]
    pub errors: Vec<RegistryFetchError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDownloadProgress {
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
/// the multi-registry Preferences UI ships.
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

/// Absolute download URL for a published item version.
pub fn item_download_url(
    registry_base: &str,
    publisher_id: &str,
    item_type: &str,
    id: &str,
    version: &str,
) -> String {
    join_url(
        registry_base,
        &format!("v1/items/{publisher_id}/{item_type}/{id}/versions/{version}/download"),
    )
}

/// Validate a publisher id, item type and item id before they go into a URL path.
fn item_path(publisher_id: &str, item_type: &str, id: &str) -> Result<String, String> {
    let (publisher_id, item_type, id) = (publisher_id.trim(), item_type.trim(), id.trim());
    if publisher_id.is_empty() || item_type.is_empty() || id.is_empty() {
        return Err("publisherId, itemType and id are required".into());
    }
    if !is_kebab_slug(publisher_id) || !is_kebab_slug(id) {
        return Err("publisherId and id must be kebab-case slugs".into());
    }
    if item_type_folder(item_type).is_none() {
        return Err(format!("unknown item type \"{item_type}\""));
    }
    Ok(format!("v1/items/{publisher_id}/{item_type}/{id}"))
}

/// A version path segment: `latest` or a semver-looking string.
fn version_segment(version: &str) -> Result<&str, String> {
    let version = version.trim();
    let ok = !version.is_empty()
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'));
    if ok {
        Ok(version)
    } else {
        Err(format!("invalid version \"{version}\""))
    }
}

/// Send a request and decode its JSON body, with friendly errors for a down registry.
fn send_for_json<T: DeserializeOwned>(
    request: reqwest::blocking::RequestBuilder,
    base: &str,
    what: &str,
) -> Result<T, String> {
    let response = request.send().map_err(|e| {
        if e.is_timeout() {
            format!("registry timed out ({base})")
        } else if e.is_connect() {
            format!("could not reach registry ({base})")
        } else {
            format!("registry request failed: {e}")
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(format!(
            "registry returned {status}{}",
            if snippet.is_empty() {
                String::new()
            } else {
                format!(": {snippet}")
            }
        ));
    }

    response
        .json()
        .map_err(|e| format!("registry returned invalid {what} JSON: {e}"))
}

/// `GET {registry}/v1/items` against one base URL (no provenance tagging).
pub fn fetch_item_catalog_from_base(
    registry_base: &str,
    query: &ItemCatalogQuery,
) -> Result<RemoteItemList, String> {
    let base = normalize_registry_url(registry_base)?;
    let mut params: Vec<(&str, String)> = Vec::new();
    let mut push = |key: &'static str, value: Option<&str>| {
        if let Some(v) = value.map(str::trim).filter(|s| !s.is_empty()) {
            params.push((key, v.to_string()));
        }
    };
    let types = query.item_types.join(",");
    push("type", Some(&types));
    push("q", query.q.as_deref());
    push("publisher", query.publisher_id.as_deref());
    push("sort", query.sort.as_deref());
    if let Some(limit) = query.limit {
        params.push(("limit", limit.to_string()));
    }
    if let Some(offset) = query.offset {
        params.push(("offset", offset.to_string()));
    }

    let client = http_client(CATALOG_TIMEOUT)?;
    let request = client.get(join_url(&base, "v1/items")).query(&params);
    send_for_json(request, &base, "catalog")
}

/// Fetch catalogs from every configured registry; tag rows with provenance.
///
/// Partial failure is non-fatal: successful sources still contribute items, and
/// per-source errors are returned alongside so UI can show a friendly state.
pub fn fetch_item_catalog(app: &AppHandle, query: &ItemCatalogQuery) -> RegistryItemList {
    let sources = configured_registries(app);
    let mut items = Vec::new();
    let mut errors = Vec::new();
    let mut total = 0;

    if sources.is_empty() {
        errors.push(RegistryFetchError {
            registry_url: effective_registry_url(),
            error: "no registries configured".into(),
        });
        return RegistryItemList {
            items,
            total,
            errors,
        };
    }

    for source in sources {
        match fetch_item_catalog_from_base(&source.url, query) {
            Ok(remote) => {
                total += remote.total.max(remote.items.len());
                for item in remote.items {
                    items.push(SourcedRegistryItemSummary {
                        registry_url: source.url.clone(),
                        publisher_id: item.publisher_id,
                        item_type: item.item_type,
                        id: item.id,
                        effective_id: item.effective_id,
                        latest_version: item.latest_version,
                    });
                }
            }
            Err(error) => errors.push(RegistryFetchError {
                registry_url: source.url,
                error,
            }),
        }
    }

    RegistryItemList {
        items,
        total,
        errors,
    }
}

/// `GET {registry}/v1/items/{publisher}/{type}/{id}`: all published (non-yanked) versions.
pub fn fetch_item_detail_from_base(
    registry_base: &str,
    publisher_id: &str,
    item_type: &str,
    id: &str,
) -> Result<RegistryItemDetail, String> {
    let base = normalize_registry_url(registry_base)?;
    let path = item_path(publisher_id, item_type, id)?;
    let client = http_client(CATALOG_TIMEOUT)?;
    let mut detail: RegistryItemDetail =
        send_for_json(client.get(join_url(&base, &path)), &base, "item detail")?;
    detail.registry_url = base;
    Ok(detail)
}

pub fn fetch_item_detail(
    app: &AppHandle,
    registry_url: &str,
    publisher_id: &str,
    item_type: &str,
    id: &str,
) -> Result<RegistryItemDetail, String> {
    let source = find_registry_by_url(app, registry_url)?;
    fetch_item_detail_from_base(&source.url, publisher_id, item_type, id)
}

/// `GET .../versions/{version}` (use `latest` for the newest version).
pub fn fetch_item_version_detail_from_base(
    registry_base: &str,
    publisher_id: &str,
    item_type: &str,
    id: &str,
    version: &str,
) -> Result<RegistryVersionDetail, String> {
    let base = normalize_registry_url(registry_base)?;
    let path = format!(
        "{}/versions/{}",
        item_path(publisher_id, item_type, id)?,
        version_segment(version)?
    );
    let client = http_client(CATALOG_TIMEOUT)?;
    let mut detail: RegistryVersionDetail =
        send_for_json(client.get(join_url(&base, &path)), &base, "version detail")?;
    detail.registry_url = base;
    Ok(detail)
}

pub fn fetch_item_version_detail(
    app: &AppHandle,
    registry_url: &str,
    publisher_id: &str,
    item_type: &str,
    id: &str,
    version: &str,
) -> Result<RegistryVersionDetail, String> {
    let source = find_registry_by_url(app, registry_url)?;
    fetch_item_version_detail_from_base(&source.url, publisher_id, item_type, id, version)
}

/// `POST {registry}/v1/items/updates` for `items`, in batches of the registry's cap.
/// Only versions the running app can use are offered (the registry filters on `appVersion`).
pub fn check_updates_at_base(
    registry_base: &str,
    app_version: &str,
    items: &[InstalledItemRef],
) -> Result<Vec<RemoteItemUpdate>, String> {
    let base = normalize_registry_url(registry_base)?;
    let client = http_client(CATALOG_TIMEOUT)?;
    let url = join_url(&base, "v1/items/updates");
    let mut updates = Vec::new();
    for batch in items.chunks(UPDATE_CHECK_BATCH) {
        let body = UpdateCheckBody {
            app_version,
            items: batch,
        };
        let remote: RemoteUpdateCheck =
            send_for_json(client.post(&url).json(&body), &base, "update check")?;
        updates.extend(remote.updates);
    }
    Ok(updates)
}

/// Items in the `installed/` zone, which are the only ones the registry can update.
/// Builtin and linked items never come from a registry.
pub fn installed_item_refs(app: &AppHandle) -> Vec<InstalledItemRef> {
    list_installed_items(app)
        .into_iter()
        .map(|item| InstalledItemRef {
            publisher_id: item.publisher_id,
            item_type: item.r#type,
            id: item.local_id,
            version: item.version,
        })
        .collect()
}

/// Whether a returned update is genuinely newer than what is installed. The registry already
/// filters this; checking again keeps a misbehaving registry from downgrading an item.
fn is_newer(latest: &str, installed: &str) -> bool {
    version_cmp(latest, installed) == Some(Ordering::Greater)
}

/// Check every configured registry for newer versions of the installed items.
pub fn check_item_updates(app: &AppHandle) -> ItemUpdateCheck {
    let installed = installed_item_refs(app);
    let mut result = ItemUpdateCheck::default();
    if installed.is_empty() {
        return result;
    }

    for source in configured_registries(app) {
        match check_updates_at_base(&source.url, app_version(), &installed) {
            Ok(updates) => result
                .updates
                .extend(fold_updates(&source.url, &installed, updates)),
            Err(error) => result.errors.push(RegistryFetchError {
                registry_url: source.url,
                error,
            }),
        }
    }
    result
}

/// Keep updates that match an installed item and are newer than it, tagged with the registry.
fn fold_updates(
    registry_url: &str,
    installed: &[InstalledItemRef],
    updates: Vec<RemoteItemUpdate>,
) -> Vec<RegistryItemUpdate> {
    updates
        .into_iter()
        .filter_map(|update| {
            let local = installed.iter().find(|i| {
                i.publisher_id == update.publisher_id
                    && i.item_type == update.item_type
                    && i.id == update.id
            })?;
            if !is_newer(&update.latest.version, &local.version) {
                return None;
            }
            Some(RegistryItemUpdate {
                registry_url: registry_url.to_string(),
                effective_id: super::effective_item_id(
                    &update.publisher_id,
                    &update.item_type,
                    &update.id,
                ),
                publisher_id: update.publisher_id,
                item_type: update.item_type,
                id: update.id,
                installed_version: local.version.clone(),
                latest: update.latest,
            })
        })
        .collect()
}

/// Version of an item installed in the `installed/` zone, if any.
pub fn installed_item_version(app: &AppHandle, effective_id: &str) -> Option<String> {
    list_installed_items(app)
        .into_iter()
        .find(|item| item.effective_id == effective_id)
        .map(|item| item.version)
}

fn http_client_with_redirect(
    timeout: Duration,
    redirect: reqwest::redirect::Policy,
) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(crate::USER_AGENT)
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

pub fn item_meets_min_app_version(min_app_version: Option<&str>) -> bool {
    match min_app_version.map(str::trim).filter(|s| !s.is_empty()) {
        None => true,
        Some(min) => meets_min_app_version(min, app_version()),
    }
}

/// Disk cache root for registry-fetched preview images.
pub fn registry_assets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings::app_data_dir(app)?.join("registry-assets"))
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

/// Fetch an image from an allowlisted registry URL into `{app_data}/registry-assets/`.
///
/// Soft-fails (`None`) on network / type / size errors so catalog enrich stays non-fatal.
/// Does not follow redirects; body is streamed and aborted past [`MAX_REGISTRY_ASSET_BYTES`].
/// Shared primitive for item preview images and other registry media.
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
pub fn resolve_registry_item_preview(
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

/// Download an item `.spk`, verify its sha256, check that it is the item the catalog promised,
/// then install it (replacing any installed version).
///
/// Integrity or identity failure deletes the temp file and never touches `installed/`.
/// `catalog_size_bytes` is display metadata (uncompressed on-disk size); progress
/// uses HTTP `Content-Length` when present.
pub fn install_item_from_url<P>(
    app: &AppHandle,
    download_url: &str,
    expected_sha256: &str,
    catalog_size_bytes: u64,
    expected: &ExpectedItem,
    on_progress: Option<&P>,
) -> Result<InstallItemResult, String>
where
    P: Fn(ItemDownloadProgress) + ?Sized,
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

    let install_result = install_item_from_path_expecting(app, &temp_path, Some(expected));
    let _ = fs::remove_file(&temp_path);
    install_result
}

fn download_spk_verified<P>(
    download_url: &str,
    expected_sha256_lower: &str,
    on_progress: Option<&P>,
) -> Result<PathBuf, String>
where
    P: Fn(ItemDownloadProgress) + ?Sized,
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
            "item download timed out".to_string()
        } else if e.is_connect() {
            format!("could not download item ({url})")
        } else {
            format!("item download failed: {e}")
        }
    })?;

    let status = response.status();
    if status.as_u16() == 410 {
        return Err("item is no longer available (purged from the registry)".into());
    }
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(format!(
            "item download returned {status}{}",
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
        "spiral-item-dl-{}-{}.spk",
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
            cb(ItemDownloadProgress { current: 0, total });
        }

        loop {
            ensure_not_cancelled()?;
            let n = response
                .read(&mut buf)
                .map_err(|e| format!("item download read failed: {e}"))?;
            if n == 0 {
                break;
            }
            let next = downloaded.saturating_add(n as u64);
            if total > 0 && next > total {
                return Err(format!("downloaded item exceeded Content-Length ({total})"));
            }
            file.write_all(&buf[..n])
                .map_err(|e| format!("failed to write temp download file: {e}"))?;
            hasher.update(&buf[..n]);
            downloaded = next;
            if let Some(cb) = on_progress {
                cb(ItemDownloadProgress {
                    current: downloaded,
                    total,
                });
            }
        }

        file.flush()
            .map_err(|e| format!("failed to flush temp download file: {e}"))?;
        drop(file);

        if downloaded == 0 {
            return Err("downloaded item was empty".into());
        }
        if total > 0 && downloaded != total {
            return Err(format!(
                "downloaded item size mismatch (Content-Length {total}, got {downloaded})"
            ));
        }

        let actual_sha = hex::encode(hasher.finalize());
        if actual_sha != expected_sha256_lower {
            return Err("downloaded item failed integrity check (sha256 mismatch)".to_string());
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
    let bytes = fs::read(path).map_err(|e| format!("failed to read downloaded item: {e}"))?;
    if bytes.is_empty() {
        return Err("downloaded item was empty".into());
    }
    let actual = hex::encode(Sha256::digest(&bytes));
    let expected = expected_sha256.trim().to_ascii_lowercase();
    if actual != expected {
        return Err("downloaded item failed integrity check (sha256 mismatch)".into());
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
            "http://127.0.0.1:8787/v1/items/a/theme/b/versions/1.0.0/preview",
            base
        ));
        assert!(is_url_under_registry_base("http://127.0.0.1:8787", base));
        assert!(!is_url_under_registry_base(
            "http://127.0.0.1:8787.evil/preview",
            base
        ));
        assert!(!is_url_under_registry_base(
            "https://spk.spiralpowered.com/v1/items/a/theme/b/versions/1.0.0/preview",
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
    fn item_meets_min_app_version_none_is_ok() {
        assert!(item_meets_min_app_version(None));
        assert!(item_meets_min_app_version(Some("")));
        assert!(item_meets_min_app_version(Some("0.0.1")));
        assert!(!item_meets_min_app_version(Some("999.0.0")));
    }

    #[test]
    fn cancel_flag_tripwire() {
        clear_download_cancel();
        assert!(ensure_not_cancelled().is_ok());
        request_download_cancel();
        assert_eq!(
            ensure_not_cancelled().unwrap_err(),
            DOWNLOAD_CANCELLED_MESSAGE
        );
        clear_download_cancel();
        assert!(ensure_not_cancelled().is_ok());
    }

    #[test]
    fn item_download_url_joins_base() {
        assert_eq!(
            item_download_url("https://reg.example", "spiral", "skin", "t3", "1.0.0"),
            "https://reg.example/v1/items/spiral/skin/t3/versions/1.0.0/download"
        );
    }

    #[test]
    fn item_path_rejects_unsafe_segments() {
        assert_eq!(
            item_path("spiral", "theme", "noir").unwrap(),
            "v1/items/spiral/theme/noir"
        );
        assert!(item_path("spiral", "theme", "../etc").is_err());
        assert!(item_path("sp/iral", "theme", "noir").is_err());
        assert!(item_path("spiral", "widget", "noir").is_err());
        assert!(item_path("", "theme", "noir").is_err());
        assert!(version_segment("latest").is_ok());
        assert!(version_segment("1.2.3-beta.1+build").is_ok());
        assert!(version_segment("1/../2").is_err());
        assert!(version_segment("").is_err());
    }

    fn summary(version: &str) -> RegistryVersionSummary {
        RegistryVersionSummary {
            version: version.into(),
            name: "Noir".into(),
            description: String::new(),
            min_app_version: None,
            size_bytes: 10,
            sha256: "0".repeat(64),
            published_at: "2026-10-16T00:00:00Z".into(),
            preview_url: None,
        }
    }

    fn installed(publisher: &str, item_type: &str, id: &str, version: &str) -> InstalledItemRef {
        InstalledItemRef {
            publisher_id: publisher.into(),
            item_type: item_type.into(),
            id: id.into(),
            version: version.into(),
        }
    }

    fn remote_update(publisher: &str, item_type: &str, id: &str, latest: &str) -> RemoteItemUpdate {
        RemoteItemUpdate {
            publisher_id: publisher.into(),
            item_type: item_type.into(),
            id: id.into(),
            latest: summary(latest),
        }
    }

    #[test]
    fn fold_updates_keeps_only_newer_known_items() {
        let local = [
            installed("spiral", "theme", "noir", "1.0.0"),
            installed("spiral", "skin", "vanilla", "2.0.0"),
        ];
        let updates = fold_updates(
            "https://reg.example",
            &local,
            vec![
                remote_update("spiral", "theme", "noir", "1.1.0"),
                // Not newer: a registry must not push a downgrade or a no-op.
                remote_update("spiral", "skin", "vanilla", "2.0.0"),
                // Not installed locally.
                remote_update("spiral", "sound", "default", "9.0.0"),
            ],
        );
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].effective_id, "spiral.theme.noir");
        assert_eq!(updates[0].installed_version, "1.0.0");
        assert_eq!(updates[0].latest.version, "1.1.0");
        assert_eq!(updates[0].registry_url, "https://reg.example");
    }

    // --- HTTP against a one-shot local server -----------------------------------------

    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;

    /// Serve `responses` (status line + JSON body) one per connection, recording each request.
    fn serve(
        responses: Vec<(&'static str, String)>,
    ) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request_line = String::new();
                reader.read_line(&mut request_line).unwrap();
                let mut content_length = 0usize;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        content_length = v.trim().parse().unwrap_or(0);
                    }
                }
                let mut payload = vec![0u8; content_length];
                reader.read_exact(&mut payload).unwrap();
                seen.push(format!(
                    "{} {}",
                    request_line.trim(),
                    String::from_utf8_lossy(&payload)
                ));
                write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
            seen
        });
        (base, handle)
    }

    const VERSION_JSON: &str = r#"{"version":"1.1.0","name":"Noir","description":"","minAppVersion":null,"sizeBytes":10,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","publishedAt":"2026-10-16T00:00:00Z","previewUrl":"/v1/items/spiral/theme/noir/versions/1.1.0/preview"}"#;

    #[test]
    fn catalog_request_carries_filters_and_parses_items() {
        let body = format!(
            r#"{{"items":[{{"publisherId":"spiral","itemType":"theme","id":"noir","effectiveId":"spiral.theme.noir","latestVersion":{VERSION_JSON}}}],"total":7,"limit":1,"offset":2}}"#
        );
        let (base, handle) = serve(vec![("200 OK", body)]);
        let query = ItemCatalogQuery {
            item_types: vec!["theme".into(), "skin".into()],
            q: Some("no ir".into()),
            publisher_id: Some("spiral".into()),
            sort: Some("newest".into()),
            limit: Some(1),
            offset: Some(2),
        };
        let list = fetch_item_catalog_from_base(&format!("{base}/"), &query).unwrap();
        assert_eq!(list.total, 7);
        assert_eq!(list.items[0].effective_id, "spiral.theme.noir");
        assert_eq!(list.items[0].latest_version.version, "1.1.0");

        let request = handle.join().unwrap().remove(0);
        assert!(request.starts_with("GET /v1/items?"), "{request}");
        for part in [
            "type=theme%2Cskin",
            "q=no+ir",
            "publisher=spiral",
            "sort=newest",
            "limit=1",
            "offset=2",
        ] {
            assert!(request.contains(part), "{part} missing from {request}");
        }
    }

    #[test]
    fn detail_and_version_requests_fill_in_registry_url() {
        let detail = format!(
            r#"{{"publisherId":"spiral","itemType":"theme","id":"noir","effectiveId":"spiral.theme.noir","versions":[{VERSION_JSON}]}}"#
        );
        let version = format!(
            r##"{{"publisherId":"spiral","itemType":"theme","id":"noir","effectiveId":"spiral.theme.noir","readme":"# Noir","version":"1.1.0","name":"Noir","description":"","minAppVersion":null,"sizeBytes":10,"sha256":"{}","publishedAt":"2026-10-16T00:00:00Z"}}"##,
            "a".repeat(64)
        );
        let (base, handle) = serve(vec![("200 OK", detail), ("200 OK", version)]);

        let item = fetch_item_detail_from_base(&base, "spiral", "theme", "noir").unwrap();
        assert_eq!(item.registry_url, base);
        assert_eq!(item.versions.len(), 1);

        let v = fetch_item_version_detail_from_base(&base, "spiral", "theme", "noir", "latest")
            .unwrap();
        assert_eq!(v.registry_url, base);
        assert_eq!(v.version.version, "1.1.0");
        assert_eq!(v.readme.as_deref(), Some("# Noir"));
        assert_eq!(v.changelog, None);

        let seen = handle.join().unwrap();
        assert!(
            seen[0].starts_with("GET /v1/items/spiral/theme/noir "),
            "{}",
            seen[0]
        );
        assert!(
            seen[1].starts_with("GET /v1/items/spiral/theme/noir/versions/latest "),
            "{}",
            seen[1]
        );
    }

    #[test]
    fn http_errors_are_reported_with_status_and_body() {
        let (base, _handle) = serve(vec![("404 Not Found", r#"{"code":"not_found"}"#.into())]);
        let err = fetch_item_detail_from_base(&base, "spiral", "theme", "noir").unwrap_err();
        assert!(err.contains("404"), "{err}");
        assert!(err.contains("not_found"), "{err}");
    }

    #[test]
    fn update_check_posts_installed_items_and_app_version_in_batches() {
        let update = format!(
            r#"{{"publisherId":"spiral","itemType":"theme","id":"noir","installedVersion":"1.0.0","latest":{VERSION_JSON}}}"#
        );
        let (base, handle) = serve(vec![
            (
                "200 OK",
                format!(r#"{{"updates":[{update}],"unlisted":[]}}"#),
            ),
            ("200 OK", r#"{"updates":[],"unlisted":[]}"#.into()),
        ]);
        // One more than the cap forces a second request.
        let mut items: Vec<InstalledItemRef> = (0..UPDATE_CHECK_BATCH)
            .map(|i| installed("spiral", "theme", &format!("t{i}"), "1.0.0"))
            .collect();
        items.push(installed("spiral", "theme", "noir", "1.0.0"));

        let updates = check_updates_at_base(&base, "0.4.0", &items).unwrap();
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].latest.version, "1.1.0");

        let seen = handle.join().unwrap();
        assert_eq!(seen.len(), 2);
        assert!(
            seen[0].starts_with("POST /v1/items/updates "),
            "{}",
            seen[0]
        );
        assert!(
            seen[0].contains(r#""appVersion":"0.4.0""#),
            "{}",
            &seen[0][..200]
        );
        assert!(seen[1].contains(r#""id":"noir""#));
        assert!(!seen[1].contains(r#""id":"t0""#));
    }

    /// End-to-end check against a running registry (`cargo run --bin spk-registry-seed`, then
    /// `cargo run`, both in apps/registry). Run with:
    /// `SPK_TEST_REGISTRY=http://127.0.0.1:8787 cargo test live_registry -- --ignored`.
    #[test]
    #[ignore = "needs a seeded registry; set SPK_TEST_REGISTRY"]
    fn live_registry_catalog_detail_download_and_updates() {
        let base = std::env::var("SPK_TEST_REGISTRY").expect("SPK_TEST_REGISTRY");

        let list = fetch_item_catalog_from_base(
            &base,
            &ItemCatalogQuery {
                item_types: vec!["theme".into()],
                ..Default::default()
            },
        )
        .unwrap();
        let theme = list
            .items
            .iter()
            .find(|i| i.effective_id == "spiral.theme.demo-theme")
            .expect("seeded demo-theme");

        let detail = fetch_item_detail_from_base(&base, "spiral", "theme", "demo-theme").unwrap();
        assert!(detail.versions.len() >= 2);
        let latest =
            fetch_item_version_detail_from_base(&base, "spiral", "theme", "demo-theme", "latest")
                .unwrap();
        assert_eq!(latest.version.version, theme.latest_version.version);
        assert!(latest.readme.is_some());

        // The download is the archive the catalog's sha256 describes.
        let url = item_download_url(
            &base,
            "spiral",
            "theme",
            "demo-theme",
            &latest.version.version,
        );
        let temp = download_spk_verified(
            &url,
            &latest.version.sha256,
            None::<&fn(ItemDownloadProgress)>,
        )
        .unwrap();
        assert!(fs::metadata(&temp).unwrap().len() > 0);
        let _ = fs::remove_file(&temp);

        // An older installed version is offered the newest compatible one.
        let items = [InstalledItemRef {
            publisher_id: "spiral".into(),
            item_type: "theme".into(),
            id: "demo-theme".into(),
            version: "1.0.0".into(),
        }];
        let updates = check_updates_at_base(&base, "0.4.0", &items).unwrap();
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].latest.version, latest.version.version);
        let current = [InstalledItemRef {
            version: latest.version.version.clone(),
            ..items[0].clone()
        }];
        assert!(check_updates_at_base(&base, "0.4.0", &current)
            .unwrap()
            .is_empty());
    }
}
