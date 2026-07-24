use crate::audio_formats::is_zip_file;
use crate::file_scan::scan_folder_paths;
use serde::Serialize;
use std::fs::{self, File};
use std::io::copy;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

#[derive(Debug, Serialize)]
pub struct ZipImportScan {
    pub extract_dir: String,
    pub audio_paths: Vec<String>,
}

fn zip_import_temp_dir(zip_path: &Path) -> PathBuf {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    zip_path.hash(&mut hasher);
    std::env::temp_dir().join(format!(
        "spiral-zip-import-{}-{:x}",
        std::process::id(),
        hasher.finish()
    ))
}

fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| format!("failed to open zip: {e}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("failed to read zip archive: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("failed to read zip entry {i}: {e}"))?;

        let Some(entry_path) = entry.enclosed_name().map(|p| p.to_owned()) else {
            return Err(format!(
                "zip entry has an invalid path: {}",
                entry.name()
            ));
        };

        let outpath = dest.join(&entry_path);

        if entry.is_dir() || entry.name().ends_with('/') {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("failed to create directory {}: {e}", outpath.display()))?;
            continue;
        }

        if let Some(parent) = outpath.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create parent directory for {}: {e}", outpath.display()))?;
        }

        let mut outfile =
            File::create(&outpath).map_err(|e| format!("failed to create {}: {e}", outpath.display()))?;
        copy(&mut entry, &mut outfile)
            .map_err(|e| format!("failed to extract {}: {e}", entry.name()))?;
    }

    Ok(())
}

pub fn scan_zip_import_path(zip_path: &str) -> Result<ZipImportScan, String> {
    let source = Path::new(zip_path);
    if !source.is_file() {
        return Err(format!("Not a file: {zip_path}"));
    }
    if !is_zip_file(source) {
        return Err(format!("Not a zip archive: {zip_path}"));
    }

    let extract_dir = zip_import_temp_dir(source);
    if extract_dir.exists() {
        fs::remove_dir_all(&extract_dir)
            .map_err(|e| format!("failed to clear previous zip extract directory: {e}"))?;
    }
    fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("failed to create zip extract directory: {e}"))?;

    extract_zip(source, &extract_dir)?;

    let audio_paths = scan_folder_paths(extract_dir.to_str().unwrap_or_default())?;
    Ok(ZipImportScan {
        extract_dir: extract_dir.to_string_lossy().into_owned(),
        audio_paths,
    })
}

pub fn cleanup_zip_import_path(extract_dir: &str) -> Result<(), String> {
    let path = Path::new(extract_dir);
    if !path.exists() {
        return Ok(());
    }

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if !file_name.starts_with("spiral-zip-import-") {
        return Err(format!("Refusing to delete non-import directory: {extract_dir}"));
    }

    fs::remove_dir_all(path).map_err(|e| format!("failed to remove zip extract directory: {e}"))
}

#[tauri::command]
pub fn scan_zip_import(zip_path: String) -> Result<ZipImportScan, String> {
    scan_zip_import_path(&zip_path)
}

#[tauri::command]
pub fn cleanup_zip_import(extract_dir: String) -> Result<(), String> {
    cleanup_zip_import_path(&extract_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn write_test_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();

        for (name, bytes) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }

        zip.finish().unwrap();
    }

    #[test]
    fn extracts_supported_audio_files() {
        let dir = std::env::temp_dir().join(format!("spiral-zip-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let zip_path = dir.join("album.zip");
        write_test_zip(
            &zip_path,
            &[
                ("01-track.mp3", b"mp3"),
                ("notes.txt", b"ignore"),
                ("disc/02-track.flac", b"flac"),
            ],
        );

        let result = scan_zip_import_path(zip_path.to_str().unwrap()).unwrap();
        assert_eq!(result.audio_paths.len(), 2);
        assert!(result
            .audio_paths
            .iter()
            .any(|p| p.ends_with("01-track.mp3")));
        assert!(result.audio_paths.iter().any(|p| {
            let normalized = p.replace('\\', "/");
            normalized.ends_with("disc/02-track.flac")
        }));

        cleanup_zip_import_path(&result.extract_dir).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_zip_slip_paths() {
        let dir = std::env::temp_dir().join(format!("spiral-zip-slip-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let zip_path = dir.join("evil.zip");
        write_test_zip(&zip_path, &[("../escape.mp3", b"mp3")]);

        let err = scan_zip_import_path(zip_path.to_str().unwrap()).unwrap_err();
        assert!(err.contains("invalid path"));

        let _ = fs::remove_dir_all(&dir);
    }
}
