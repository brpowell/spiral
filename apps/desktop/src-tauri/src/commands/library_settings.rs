use crate::commands::library::DbState;
use crate::import_files;
use crate::library_paths;
use crate::library_relocate::{self, LibraryRelocateMode};
use crate::path_scope;
use crate::rating_sync::RatingSync;
use crate::settings::{self, LibrarySettingsPatch, LibrarySettingsResponse};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_library_settings(app: AppHandle) -> Result<LibrarySettingsResponse, String> {
    Ok(settings::resolved_library_settings(&app))
}

#[tauri::command]
pub fn save_library_settings(
    app: AppHandle,
    library: LibrarySettingsPatch,
) -> Result<LibrarySettingsResponse, String> {
    let resolved = settings::merge_library_settings(&app, library)?;
    library_paths::ensure_spiral_library(&resolved)?;
    path_scope::allow_library_dirs(&app);
    Ok(resolved)
}

#[tauri::command]
pub fn prepare_import_file(
    app: AppHandle,
    source_path: String,
    mode: String,
) -> Result<String, String> {
    path_scope::ensure_allowed(&app, &source_path)?;
    let resolved = settings::resolved_library_settings(&app);
    import_files::prepare_import_file(
        &source_path,
        &mode,
        resolved.auto_organize,
        &resolved.media_folder,
        &resolved.organize_path_format,
        settings::lyrics_sidecar_sync_enabled(&app),
        None,
    )
}

/// `start` itself, or its closest ancestor that exists, so the picker never
/// opens on a folder that has not been created yet (e.g. a fresh default library).
fn nearest_existing_dir(start: &str) -> Option<std::path::PathBuf> {
    let mut candidate = std::path::Path::new(start);
    if candidate.as_os_str().is_empty() {
        return None;
    }
    loop {
        if candidate.is_dir() {
            return Some(candidate.to_path_buf());
        }
        candidate = candidate.parent()?;
    }
}

#[tauri::command]
pub fn pick_library_folder(start_dir: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new().set_title("Choose Spiral library folder");
    if let Some(dir) = start_dir.as_deref().and_then(nearest_existing_dir) {
        dialog = dialog.set_directory(dir);
    }
    let folder = dialog.pick_folder();

    Ok(folder.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn inspect_library_destination(
    app: AppHandle,
    path: String,
) -> Result<library_relocate::LibraryDestinationInfo, String> {
    library_relocate::inspect_library_destination(&app, &path)
}

#[tauri::command]
pub fn relocate_library(
    app: AppHandle,
    state: State<'_, DbState>,
    rating_sync: State<'_, RatingSync>,
    new_root: String,
    mode: LibraryRelocateMode,
) -> Result<LibrarySettingsResponse, String> {
    let resolved = library_relocate::relocate_library(&app, &state, &rating_sync, &new_root, mode)?;
    path_scope::allow_library_dirs(&app);
    // The open library may have other watched folders now.
    super::organize::init(&app);
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::nearest_existing_dir;

    #[test]
    fn nearest_existing_dir_returns_existing_dir_as_is() {
        let dir = std::env::temp_dir();
        assert_eq!(nearest_existing_dir(dir.to_str().unwrap()), Some(dir));
    }

    #[test]
    fn nearest_existing_dir_walks_up_from_missing_folder() {
        let dir = std::env::temp_dir();
        let missing = dir.join("spiral-missing-library").join("nested");
        assert_eq!(nearest_existing_dir(missing.to_str().unwrap()), Some(dir));
    }

    #[test]
    fn nearest_existing_dir_ignores_empty_input() {
        assert_eq!(nearest_existing_dir(""), None);
    }
}
