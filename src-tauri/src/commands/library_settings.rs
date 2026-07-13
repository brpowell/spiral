use crate::commands::library::DbState;
use crate::import_files;
use crate::library_paths;
use crate::library_relocate::{self, LibraryRelocateMode};
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
    Ok(resolved)
}

#[tauri::command]
pub fn prepare_import_file(
    app: AppHandle,
    source_path: String,
    mode: String,
) -> Result<String, String> {
    let resolved = settings::resolved_library_settings(&app);
    import_files::prepare_import_file(
        &source_path,
        &mode,
        resolved.auto_organize,
        &resolved.media_folder,
        &resolved.organize_path_format,
        settings::lyrics_sidecar_sync_enabled(&app),
    )
}

#[tauri::command]
pub fn pick_library_folder() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("Choose Spiral library folder")
        .pick_folder();

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
    library_relocate::relocate_library(&app, &state, &rating_sync, &new_root, mode)
}
