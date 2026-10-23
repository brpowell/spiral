use crate::audio_formats::is_zip_file;
use crate::file_scan::scan_folder_paths;
use serde::Serialize;
use spk_format::{extract_zip_bounded, ExtractLimits};
use std::fs;
use std::path::{Path, PathBuf};

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

/// Album zips hold already-compressed audio (FLAC, MP3, AAC) plus artwork and
/// cue sheets, so real ones expand barely past their download size. The total cap
/// leaves room for multi-disc hi-res FLAC box sets; the entry count, the ratio
/// check and the reader's refusal to inflate an entry past its declared size are
/// what stop a small download from filling the disk.
const ALBUM_ZIP_LIMITS: ExtractLimits = ExtractLimits {
    max_entries: 5_000,
    max_uncompressed_bytes: 16 * 1024 * 1024 * 1024,
    max_compression_ratio: 20,
    ratio_check_min_bytes: 64 * 1024 * 1024,
};

fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    extract_zip_bounded(zip_path, dest, &ALBUM_ZIP_LIMITS, "zip archive")
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

    let audio_paths = extract_zip(source, &extract_dir)
        .and_then(|()| scan_folder_paths(extract_dir.to_str().unwrap_or_default()));
    let audio_paths = match audio_paths {
        Ok(paths) => paths,
        Err(e) => {
            let _ = fs::remove_dir_all(&extract_dir);
            return Err(e);
        }
    };
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

    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !file_name.starts_with("spiral-zip-import-") {
        return Err(format!(
            "Refusing to delete non-import directory: {extract_dir}"
        ));
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
    use crate::test_fixtures::zips;

    fn zip_test_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("spiral-zip-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Scan `zip_path`, expect a rejection, and check no extraction was left behind.
    fn rejected_scan(zip_path: &Path) -> String {
        let err = scan_zip_import_path(zip_path.to_str().unwrap()).unwrap_err();
        let extract_dir = zip_import_temp_dir(zip_path);
        assert!(
            !extract_dir.exists(),
            "partial extraction left at {}",
            extract_dir.display()
        );
        err
    }

    #[test]
    fn extracts_supported_audio_files() {
        let dir = zip_test_dir("test");
        let zip_path = dir.join("album.zip");
        zips::write_stored(
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
        let dir = zip_test_dir("slip");
        let zip_path = dir.join("evil.zip");
        zips::write_stored(&zip_path, &[("../escape.mp3", b"mp3")]);

        let err = rejected_scan(&zip_path);
        assert!(err.contains("invalid path"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_an_album_zip_with_too_many_entries() {
        let dir = zip_test_dir("entries");
        let zip_path = dir.join("many.zip");
        let names: Vec<String> = (0..=ALBUM_ZIP_LIMITS.max_entries)
            .map(|i| format!("{i}.mp3"))
            .collect();
        let entries: Vec<(&str, &[u8])> = names.iter().map(|n| (n.as_str(), &b"mp3"[..])).collect();
        zips::write_stored(&zip_path, &entries);

        let err = rejected_scan(&zip_path);
        assert!(err.contains("too many entries"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_a_high_ratio_album_zip() {
        let dir = zip_test_dir("ratio");
        let zip_path = dir.join("bomb.zip");
        // 65 MiB of zeros deflates to about 64 KiB: past 20:1 once over the 64 MiB floor.
        let zeros = vec![0u8; 65 * 1024 * 1024];
        zips::write_deflated(&zip_path, &[("01-track.flac", &zeros)]);

        let err = rejected_scan(&zip_path);
        assert!(err.contains("compression ratio"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_an_album_entry_larger_than_declared() {
        let dir = zip_test_dir("understated");
        let zip_path = dir.join("liar.zip");
        zips::write_understated(&zip_path, &["01-track.flac", "02-track.flac"], 4096);

        let err = rejected_scan(&zip_path);
        assert!(err.contains("larger than its declared"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }
}
