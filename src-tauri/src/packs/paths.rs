//! Zone roots for pack scanning (builtin / workshop / installed).

use crate::settings;
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

/// Builtin packs shipped with the app under `packs/builtin/`.
pub fn builtin_packs_root(app: &AppHandle) -> PathBuf {
    let manifest_builtin = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("packs/builtin");

    // Dev builds prefer the live source tree so edits apply without bundling
    // resources (build.rs clears bundle.resources when `tauri_build::is_dev()`;
    // src-tauri/.taurignore keeps the CLI from rebuilding on pack file changes).
    #[cfg(debug_assertions)]
    if manifest_builtin.is_dir() {
        return manifest_builtin;
    }

    if let Ok(path) = app
        .path()
        .resolve("packs/builtin", BaseDirectory::Resource)
    {
        if path.is_dir() {
            return path;
        }
    }
    manifest_builtin
}

pub fn packs_app_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings::app_data_dir(app)?.join("packs"))
}

pub fn workshop_packs_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(packs_app_data_root(app)?.join("workshop"))
}

pub fn installed_packs_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(packs_app_data_root(app)?.join("installed"))
}

pub fn ensure_workshop_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = workshop_packs_root(app)?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("failed to create workshop packs directory: {e}"))?;
    }
    Ok(dir)
}

/// Ensure workshop/installed pack roots exist. Call before scanning.
pub fn ensure_packs_ready(app: &AppHandle) -> Result<(), String> {
    let _ = ensure_workshop_root(app)?;
    if let Ok(installed) = installed_packs_root(app) {
        let _ = std::fs::create_dir_all(installed);
    }
    Ok(())
}
