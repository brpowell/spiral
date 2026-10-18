//! Item registry Tauri commands (catalog, update checks, and integrity-checked install).

use crate::packs::install::{ExpectedItem, InstallItemResult};
use crate::packs::registry::{
    self, ItemCatalogQuery, ItemDownloadProgress, ItemUpdateCheck, RegistryItemDetail,
    RegistryItemList, RegistryVersionDetail,
};
use crate::packs::scan::app_version;
use crate::packs::{is_kebab_slug, item_type_folder};
use crate::settings::{self, RegistrySource};
use tauri::ipc::Channel;
use tauri::AppHandle;

/// Configured registry sources (official Spiral URL only, until multi-registry UI).
#[tauri::command]
pub fn get_registries(app: AppHandle) -> Result<Vec<RegistrySource>, String> {
    Ok(registry::configured_registries(&app))
}

/// Persist registry sources. Official Spiral URL is always retained; empty input resets.
#[tauri::command]
pub fn save_registries(
    app: AppHandle,
    registries: Vec<RegistrySource>,
) -> Result<Vec<RegistrySource>, String> {
    let resolved = registry::validate_registries_for_save(registries)?;
    let mut app_settings = settings::read_settings(&app);
    app_settings.registries = resolved.clone();
    settings::write_settings(&app, &app_settings)?;
    Ok(resolved)
}

/// `GET /v1/items` against every configured registry (partial failure → `errors[]`).
#[tauri::command]
pub fn fetch_item_catalog(
    app: AppHandle,
    query: Option<ItemCatalogQuery>,
) -> Result<RegistryItemList, String> {
    Ok(registry::fetch_item_catalog(
        &app,
        &query.unwrap_or_default(),
    ))
}

/// `GET /v1/items/:publisherId/:type/:id`: all published (non-yanked) versions.
#[tauri::command]
pub fn fetch_registry_item(
    app: AppHandle,
    registry_url: String,
    publisher_id: String,
    item_type: String,
    id: String,
) -> Result<RegistryItemDetail, String> {
    registry::fetch_item_detail(&app, &registry_url, &publisher_id, &item_type, &id)
}

/// `GET .../versions/:version` (includes README and CHANGELOG). `latest` is the newest.
#[tauri::command]
pub fn fetch_registry_item_version(
    app: AppHandle,
    registry_url: String,
    publisher_id: String,
    item_type: String,
    id: String,
    version: String,
) -> Result<RegistryVersionDetail, String> {
    registry::fetch_item_version_detail(
        &app,
        &registry_url,
        &publisher_id,
        &item_type,
        &id,
        &version,
    )
}

/// Check every configured registry for newer versions of the installed items, in one batch
/// per registry. Builtin, workshop and linked items are never checked.
#[tauri::command]
pub fn check_item_updates(app: AppHandle) -> Result<ItemUpdateCheck, String> {
    Ok(registry::check_item_updates(&app))
}

/// Running app semver used for `minAppVersion` checks (`CARGO_PKG_VERSION`).
#[tauri::command]
pub fn get_app_version() -> String {
    app_version().to_string()
}

/// Whether the running app satisfies a catalog entry's optional `minAppVersion`.
#[tauri::command]
pub fn item_meets_min_app_version(min_app_version: Option<String>) -> bool {
    registry::item_meets_min_app_version(min_app_version.as_deref())
}

/// Version of an item installed under `installed/`, from disk (no network).
#[tauri::command]
pub fn installed_item_version(
    app: AppHandle,
    effective_id: String,
) -> Result<Option<String>, String> {
    let effective_id = effective_id.trim();
    if effective_id.is_empty() {
        return Err("effectiveId is required".into());
    }
    Ok(registry::installed_item_version(&app, effective_id))
}

/// Download + install by catalog identity from a configured registry base URL.
///
/// Rejects an already-installed version and items whose `minAppVersion` exceeds the running
/// app before any download starts. The archive's own manifest must match the requested
/// identity, and it replaces the installed version (one version of an item at a time).
#[tauri::command]
pub fn install_item_from_registry(
    app: AppHandle,
    registry_url: String,
    publisher_id: String,
    item_type: String,
    id: String,
    version: String,
    sha256: String,
    size_bytes: u64,
    min_app_version: Option<String>,
    on_progress: Channel<ItemDownloadProgress>,
) -> Result<InstallItemResult, String> {
    let publisher_id = publisher_id.trim();
    let item_type = item_type.trim();
    let id = id.trim();
    let version = version.trim();
    if publisher_id.is_empty() || item_type.is_empty() || id.is_empty() || version.is_empty() {
        return Err("publisherId, itemType, id and version are required".into());
    }
    if !is_kebab_slug(publisher_id) || !is_kebab_slug(id) || item_type_folder(item_type).is_none() {
        return Err("invalid item identity".into());
    }
    if !registry::item_meets_min_app_version(min_app_version.as_deref()) {
        let min = min_app_version.as_deref().unwrap_or("?");
        return Err(format!(
            "{item_type} \"{id}\" requires minAppVersion {min} (app is {})",
            app_version()
        ));
    }
    let effective_id = crate::packs::effective_item_id(publisher_id, item_type, id);
    if registry::installed_item_version(&app, &effective_id).as_deref() == Some(version) {
        return Err(format!("{effective_id} ({version}) is already installed"));
    }

    let source = registry::find_registry_by_url(&app, &registry_url)?;
    let url = registry::item_download_url(&source.url, publisher_id, item_type, id, version);
    let expected = ExpectedItem {
        publisher_id: publisher_id.to_string(),
        item_type: item_type.to_string(),
        id: id.to_string(),
        version: version.to_string(),
    };
    registry::install_item_from_url(
        &app,
        &url,
        &sha256,
        size_bytes,
        &expected,
        Some(&|progress: ItemDownloadProgress| {
            let _ = on_progress.send(progress);
        }),
    )
}

/// Stop an in-flight [`install_item_from_registry`] at the next chunk boundary.
#[tauri::command]
pub fn cancel_item_download() {
    registry::request_download_cancel();
}

/// Clear a prior item-download cancel request.
#[tauri::command]
pub fn clear_item_download_cancel() {
    registry::clear_download_cancel();
}

/// Fetch a catalog preview into the local registry-asset cache; return a path for `convertFileSrc`.
///
/// Soft-fails to `None` when the preview is missing, the registry is unknown, or the download fails.
#[tauri::command]
pub fn resolve_registry_item_preview(
    app: AppHandle,
    registry_url: String,
    preview_url: Option<String>,
) -> Result<Option<String>, String> {
    Ok(
        registry::resolve_registry_item_preview(&app, &registry_url, preview_url.as_deref())
            .map(|p| p.to_string_lossy().into_owned()),
    )
}
