use super::library::DbState;
use crate::audio_formats::filter_library_import_paths;
use crate::db;
use crate::file_scan::scan_folder_paths;
use crate::path_scope;
use std::path::Path;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

/// In scope, or a library track's file (tracks imported by reference live anywhere).
fn is_known_path(app: &AppHandle, path: &str) -> bool {
    if path_scope::is_allowed(app, Path::new(path)) {
        return true;
    }
    let Some(state) = app.try_state::<DbState>() else {
        return false;
    };
    let Ok(conn) = state.0.lock() else {
        return false;
    };
    db::has_track_file_path(&conn, path).unwrap_or(false)
}

fn ensure_known_path(app: &AppHandle, path: &str) -> Result<(), String> {
    if is_known_path(app, path) {
        Ok(())
    } else {
        Err(path_scope::outside_scope_error(Path::new(path)))
    }
}

#[tauri::command]
pub fn pick_audio_files(app: AppHandle) -> Result<Vec<String>, String> {
    let paths = rfd::FileDialog::new()
        .set_title("Select audio files")
        .add_filter(
            "Audio",
            &[
                "mp3", "flac", "aac", "wav", "m4a", "mp4", "ogg", "opus", "zip", "MP3", "FLAC",
                "AAC", "WAV", "M4A", "MP4", "OGG", "OPUS", "ZIP",
            ],
        )
        .set_directory("/")
        .pick_files();
    if let Some(files) = &paths {
        path_scope::allow_user_paths(&app, files);
    }

    match paths {
        Some(files) => Ok(filter_library_import_paths(
            files
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
        )),
        None => Ok(vec![]),
    }
}

#[tauri::command]
pub fn scan_folder(app: AppHandle, folder_path: String) -> Result<Vec<String>, String> {
    path_scope::ensure_allowed(&app, &folder_path)?;
    scan_folder_paths(&folder_path)
}

#[tauri::command]
pub fn file_exists(app: AppHandle, path: String) -> bool {
    is_known_path(&app, &path) && Path::new(&path).is_file()
}

/// File size in bytes.
#[tauri::command]
pub fn get_file_size(app: AppHandle, path: String) -> Result<u64, String> {
    ensure_known_path(&app, &path)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("Cannot stat file: {e}"))?;
    Ok(meta.len())
}

/// Total size of all files under a directory (does not follow symlinks).
#[tauri::command]
pub fn get_directory_size(app: AppHandle, path: String) -> Result<u64, String> {
    path_scope::ensure_allowed(&app, &path)?;
    directory_size_bytes(Path::new(&path))
}

fn directory_size_bytes(root: &Path) -> Result<u64, String> {
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", root.display()));
    }

    let mut total: u64 = 0;
    for entry in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() {
            let meta = std::fs::metadata(path)
                .map_err(|e| format!("Cannot stat {}: {e}", path.display()))?;
            total = total.saturating_add(meta.len());
        }
    }
    Ok(total)
}

/// File modification time in milliseconds since UNIX epoch (for asset URL cache busting).
#[tauri::command]
pub fn get_file_modified_ms(app: AppHandle, path: String) -> Result<u64, String> {
    path_scope::ensure_allowed(&app, &path)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("Cannot stat file: {e}"))?;
    let modified = meta
        .modified()
        .map_err(|e| format!("Cannot read modification time: {e}"))?;
    modified
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .map_err(|e| format!("Invalid modification time: {e}"))
}

#[tauri::command]
pub fn pick_folder(app: AppHandle) -> Result<Vec<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("Select music folder")
        .pick_folder();

    match folder {
        Some(path) => {
            path_scope::allow_dir(&app, &path);
            Ok(vec![path.to_string_lossy().into_owned()])
        }
        None => Ok(vec![]),
    }
}

/// Open a picker for audio files and/or folders (platform-dependent capabilities).
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn pick_library_paths(app: AppHandle) -> Result<Vec<String>, String> {
    let paths = crate::macos_library_picker::pick_library_paths(&app).unwrap_or_default();
    path_scope::allow_user_paths(&app, &paths);
    Ok(filter_library_import_paths(paths))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn pick_library_paths(app: AppHandle) -> Result<Vec<String>, String> {
    pick_audio_files(app)
}

#[cfg(test)]
mod tests {
    use super::directory_size_bytes;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn directory_size_sums_nested_files() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("spiral-dir-size-{nanos}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("a.txt"), b"aaaa").unwrap();
        fs::write(root.join("nested/b.txt"), b"bbbbbb").unwrap();

        let size = directory_size_bytes(&root).unwrap();
        assert_eq!(size, 10);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn directory_size_rejects_file_path() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let file = std::env::temp_dir().join(format!("spiral-dir-size-file-{nanos}"));
        fs::write(&file, b"x").unwrap();
        assert!(directory_size_bytes(&file).is_err());
        let _ = fs::remove_file(&file);
    }
}
