use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

pub fn art_cache_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("art")
}

pub fn art_cache_key(file_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(file_path.as_bytes());
    hex::encode(hasher.finalize())[..16].to_string()
}

pub fn write_bytes_to_art_cache(
    app_data_dir: &Path,
    file_path: &str,
    bytes: &[u8],
    ext: &str,
) -> Result<PathBuf, String> {
    let dir = art_cache_dir(app_data_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("{}.{}", art_cache_key(file_path), ext));
    fs::write(&dest, bytes).map_err(|e| format!("Failed to cache album art: {e}"))?;
    Ok(dest)
}

/// Return an existing cached art file for the given logical key, if any.
pub fn find_cached_art_path(app_data_dir: &Path, file_path: &str) -> Option<PathBuf> {
    let dir = art_cache_dir(app_data_dir);
    if !dir.is_dir() {
        return None;
    }

    let prefix = art_cache_key(file_path);
    let entries = fs::read_dir(&dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(&prefix) {
            continue;
        }
        let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(&name);
        if stem != prefix {
            continue;
        }
        let path = entry.path();
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

pub fn ext_from_mime(format: &str) -> &'static str {
    let lower = format.to_ascii_lowercase();
    if lower.contains("png") {
        "png"
    } else if lower.contains("webp") {
        "webp"
    } else {
        "jpg"
    }
}

pub fn guess_ext_from_url(url: &str) -> &'static str {
    if url.contains(".png") {
        "png"
    } else if url.contains(".webp") {
        "webp"
    } else {
        "jpg"
    }
}

/// Remove cached album art keyed by library `file_path` (all extensions).
pub fn remove_cached_art(app_data_dir: &Path, file_path: &str) -> Result<(), String> {
    let dir = art_cache_dir(app_data_dir);
    if !dir.is_dir() {
        return Ok(());
    }

    let prefix = art_cache_key(file_path);
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(&prefix) {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn remove_cached_art_deletes_all_extensions_for_key() {
        let app_data =
            std::env::temp_dir().join(format!("spiral-art-cache-{}", std::process::id()));
        let _ = fs::remove_dir_all(&app_data);
        let cache_dir = art_cache_dir(&app_data);
        fs::create_dir_all(&cache_dir).unwrap();

        let file_path = "/library/media/song.mp3";
        let key = art_cache_key(file_path);
        for ext in ["jpg", "png"] {
            let path = cache_dir.join(format!("{key}.{ext}"));
            let mut f = fs::File::create(&path).unwrap();
            writeln!(f, "art").unwrap();
        }

        remove_cached_art(&app_data, file_path).unwrap();
        assert!(!cache_dir.join(format!("{key}.jpg")).exists());
        assert!(!cache_dir.join(format!("{key}.png")).exists());

        let _ = fs::remove_dir_all(&app_data);
    }

    #[test]
    fn find_cached_art_path_returns_existing_file() {
        let app_data = std::env::temp_dir().join(format!("spiral-art-find-{}", std::process::id()));
        let _ = fs::remove_dir_all(&app_data);
        let cache_dir = art_cache_dir(&app_data);
        fs::create_dir_all(&cache_dir).unwrap();

        let file_path = "Artist - Album";
        let key = art_cache_key(file_path);
        let path = cache_dir.join(format!("{key}.jpg"));
        fs::write(&path, b"art").unwrap();

        assert_eq!(
            find_cached_art_path(&app_data, file_path).as_deref(),
            Some(path.as_path())
        );
        assert!(find_cached_art_path(&app_data, "missing").is_none());

        let _ = fs::remove_dir_all(&app_data);
    }
}
