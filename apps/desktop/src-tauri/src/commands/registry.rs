//! Pack registry Tauri commands (catalog + integrity-checked install from URL).

use crate::packs::install::InstallPackResult;
use crate::packs::registry::{
    self, PackDownloadProgress, RegistryPackList, SourcedRegistryPackDetail,
    SourcedRegistryVersionDetail,
};
use crate::packs::scan::app_version;
use crate::packs::validate_contribution;
use crate::settings::{self, RegistrySource};
use tauri::ipc::Channel;
use tauri::AppHandle;

/// Configured pack registry sources (official Spiral URL only, until multi-registry UI).
#[tauri::command]
pub fn get_pack_registries(app: AppHandle) -> Result<Vec<RegistrySource>, String> {
    Ok(registry::configured_registries(&app))
}

/// Persist pack registry sources. Official Spiral URL is always retained; empty input resets.
#[tauri::command]
pub fn save_pack_registries(
    app: AppHandle,
    registries: Vec<RegistrySource>,
) -> Result<Vec<RegistrySource>, String> {
    let resolved = registry::validate_registries_for_save(registries)?;
    let mut app_settings = settings::read_settings(&app);
    app_settings.registries = resolved.clone();
    settings::write_settings(&app, &app_settings)?;
    Ok(resolved)
}

/// `GET /v1/packs` against every configured registry (partial failure → `errors[]`).
#[tauri::command]
pub fn fetch_pack_catalog(
    app: AppHandle,
    contribution_type: Option<String>,
    author_id: Option<String>,
) -> Result<RegistryPackList, String> {
    Ok(registry::fetch_pack_catalog(
        &app,
        contribution_type.as_deref(),
        author_id.as_deref(),
    ))
}

/// `GET /v1/packs/:authorId/:packId` — all published (non-yanked) versions.
#[tauri::command]
pub fn fetch_registry_pack(
    app: AppHandle,
    registry_url: String,
    author_id: String,
    pack_id: String,
) -> Result<SourcedRegistryPackDetail, String> {
    registry::fetch_pack_detail(&app, &registry_url, &author_id, &pack_id)
}

/// `GET /v1/packs/:authorId/:packId/versions/:version` (includes README).
#[tauri::command]
pub fn fetch_registry_pack_version(
    app: AppHandle,
    registry_url: String,
    author_id: String,
    pack_id: String,
    version: String,
) -> Result<SourcedRegistryVersionDetail, String> {
    registry::fetch_pack_version_detail(&app, &registry_url, &author_id, &pack_id, &version)
}

/// Running app semver used for `minAppVersion` checks (`CARGO_PKG_VERSION`).
#[tauri::command]
pub fn get_app_version() -> String {
    app_version().to_string()
}

/// Whether the running app satisfies a catalog entry's optional `minAppVersion`.
#[tauri::command]
pub fn pack_meets_min_app_version(min_app_version: Option<String>) -> bool {
    registry::pack_meets_min_app_version(min_app_version.as_deref())
}

/// Local already-installed check (`packs/installed/<authorId>.<packId>@<version>/`) — no network.
#[tauri::command]
pub fn is_pack_installed(
    app: AppHandle,
    author_id: String,
    pack_id: String,
    version: String,
) -> Result<bool, String> {
    let author_id = author_id.trim();
    let pack_id = pack_id.trim();
    let version = version.trim();
    if author_id.is_empty() || pack_id.is_empty() || version.is_empty() {
        return Err("authorId, packId, and version are required".into());
    }
    registry::is_pack_installed(&app, author_id, pack_id, version)
}

/// Download a `.spk` from `url`, verify catalog `sha256`, then install.
///
/// `size_bytes` is catalog display size (uncompressed); progress uses `Content-Length`.
/// Cancel via [`cancel_pack_download`].
#[tauri::command]
pub fn install_pack_from_url(
    app: AppHandle,
    url: String,
    sha256: String,
    size_bytes: u64,
    on_progress: Channel<PackDownloadProgress>,
) -> Result<InstallPackResult, String> {
    registry::install_pack_from_url(
        &app,
        &url,
        &sha256,
        size_bytes,
        Some(&|progress: PackDownloadProgress| {
            let _ = on_progress.send(progress);
        }),
        validate_contribution,
    )
}

/// Download + install by catalog identity from a configured registry base URL.
///
/// Rejects already-installed `authorId`+`packId`+`version` and packs whose `minAppVersion`
/// exceeds the running app (when provided) before any download starts.
#[tauri::command]
pub fn install_pack_from_registry(
    app: AppHandle,
    registry_url: String,
    author_id: String,
    pack_id: String,
    version: String,
    sha256: String,
    size_bytes: u64,
    min_app_version: Option<String>,
    on_progress: Channel<PackDownloadProgress>,
) -> Result<InstallPackResult, String> {
    let author_id = author_id.trim();
    let pack_id = pack_id.trim();
    let version = version.trim();
    if author_id.is_empty() || pack_id.is_empty() || version.is_empty() {
        return Err("authorId, packId, and version are required".into());
    }
    if !registry::pack_meets_min_app_version(min_app_version.as_deref()) {
        let min = min_app_version.as_deref().unwrap_or("?");
        return Err(format!(
            "pack \"{pack_id}\" requires minAppVersion {min} (app is {})",
            app_version()
        ));
    }
    if registry::is_pack_installed(&app, author_id, pack_id, version)? {
        return Err(format!(
            "{author_id}.{pack_id} ({version}) is already installed"
        ));
    }
    let source = registry::find_registry_by_url(&app, &registry_url)?;
    let url = registry::pack_download_url(&source.url, author_id, pack_id, version);
    install_pack_from_url(app, url, sha256, size_bytes, on_progress)
}

/// Stop an in-flight [`install_pack_from_url`] at the next chunk boundary.
#[tauri::command]
pub fn cancel_pack_download() {
    registry::request_download_cancel();
}

/// Clear a prior pack-download cancel request.
#[tauri::command]
pub fn clear_pack_download_cancel() {
    registry::clear_download_cancel();
}

/// Fetch a catalog preview into the local registry-asset cache; return a path for `convertFileSrc`.
///
/// Soft-fails to `None` when the preview is missing, the registry is unknown, or the download fails.
#[tauri::command]
pub fn resolve_registry_pack_preview(
    app: AppHandle,
    registry_url: String,
    preview_url: Option<String>,
) -> Result<Option<String>, String> {
    Ok(
        registry::resolve_registry_pack_preview(&app, &registry_url, preview_url.as_deref())
            .map(|p| p.to_string_lossy().into_owned()),
    )
}
