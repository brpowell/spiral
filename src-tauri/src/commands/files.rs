use std::path::Path;

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "aac", "wav", "m4a"];

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            AUDIO_EXTENSIONS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

pub fn scan_folder_paths(folder_path: &str) -> Result<Vec<String>, String> {
    let root = Path::new(folder_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {folder_path}"));
    }

    let mut paths = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() && is_audio_file(path) {
            paths.push(path.to_string_lossy().into_owned());
        }
    }
    paths.sort();
    Ok(paths)
}

#[tauri::command]
pub fn pick_audio_files() -> Result<Vec<String>, String> {
    let paths = rfd::FileDialog::new()
        .set_title("Select audio files")
        .add_filter(
            "Audio",
            &[
                "mp3", "flac", "aac", "wav", "m4a", "MP3", "FLAC", "AAC", "WAV", "M4A",
            ],
        )
        .set_directory("/")
        .pick_files();

    match paths {
        Some(files) => Ok(files
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect()),
        None => Ok(vec![]),
    }
}

#[tauri::command]
pub fn scan_folder(folder_path: String) -> Result<Vec<String>, String> {
    scan_folder_paths(&folder_path)
}

/// Read file bytes from disk (Rust-side; not subject to plugin-fs scope).
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| {
        eprintln!("read_file_bytes error for {path}: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn pick_folder() -> Result<Vec<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("Select music folder")
        .pick_folder();

    match folder {
        Some(path) => Ok(vec![path.to_string_lossy().into_owned()]),
        None => Ok(vec![]),
    }
}

/// Open a picker for audio files and/or folders (platform-dependent capabilities).
#[tauri::command]
pub fn pick_library_paths() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(crate::macos_library_picker::pick_library_paths().unwrap_or_default());
    }

    #[cfg(not(target_os = "macos"))]
    {
        pick_audio_files()
    }
}
