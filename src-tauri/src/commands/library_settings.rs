use crate::import_files;
use crate::library_paths;
use crate::settings::{self, LibrarySettingsPatch, LibrarySettingsResponse};
use tauri::AppHandle;

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
    source_path: String,
    mode: String,
    auto_organize: bool,
    media_folder: String,
) -> Result<String, String> {
    import_files::prepare_import_file(&source_path, &mode, auto_organize, &media_folder)
}

#[tauri::command]
pub fn pick_database_folder() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("Choose library folder for database")
        .pick_folder();

    Ok(folder.map(|p| p.to_string_lossy().into_owned()))
}
