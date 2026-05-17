use crate::settings::{self, LibrarySettingsResponse};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub fn ensure_spiral_library(resolved: &LibrarySettingsResponse) -> Result<(), String> {
    let media = Path::new(&resolved.media_folder);
    if let Some(parent) = media.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create library folder: {e}"))?;
    }
    fs::create_dir_all(media).map_err(|e| format!("failed to create media folder: {e}"))?;

    let db_path = Path::new(&resolved.database_path);
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create database folder: {e}"))?;
    }

    Ok(())
}

pub fn ensure_library_for_app(app: &AppHandle) -> Result<PathBuf, String> {
    let resolved = settings::resolved_library_settings(app);
    ensure_spiral_library(&resolved)?;
    Ok(PathBuf::from(resolved.database_path))
}
