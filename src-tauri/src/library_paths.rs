use crate::settings::{self, LibrarySettingsResponse};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub fn ensure_spiral_library(resolved: &LibrarySettingsResponse) -> Result<(), String> {
    let root = Path::new(&resolved.library_root);
    fs::create_dir_all(root).map_err(|e| format!("failed to create library folder: {e}"))?;

    let media = Path::new(&resolved.media_folder);
    fs::create_dir_all(media).map_err(|e| format!("failed to create media folder: {e}"))?;

    Ok(())
}

pub fn ensure_library_for_app(app: &AppHandle) -> Result<PathBuf, String> {
    let resolved = settings::resolved_library_settings(app);
    ensure_spiral_library(&resolved)?;
    Ok(PathBuf::from(resolved.database_path))
}
