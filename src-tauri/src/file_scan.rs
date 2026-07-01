use crate::audio_formats::is_supported_audio_file;
use std::path::Path;

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
        if path.is_file() && is_supported_audio_file(path) {
            paths.push(path.to_string_lossy().into_owned());
        }
    }
    paths.sort();
    Ok(paths)
}
