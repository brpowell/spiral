//! One-shot leftover cleanup for the retired sidecar tag-backup files
//! (`song.m4a.bak`, etc.). Tag writes no longer clone the original; they
//! copy to a temp file, validate a playback load, then replace in place.

use crate::db;
use crate::settings;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use walkdir::WalkDir;

const BACKUP_SUFFIXES: &[&str] = &[
    ".m4a.bak",
    ".mp4.bak",
    ".mp3.bak",
    ".flac.bak",
    ".aac.bak",
    ".wav.bak",
    ".ogg.bak",
    ".opus.bak",
];

fn is_spiral_metadata_backup(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    BACKUP_SUFFIXES.iter().any(|suffix| name.ends_with(suffix))
}

fn purge_backups_under(root: &Path) -> Result<usize, String> {
    if !root.is_dir() {
        return Ok(0);
    }

    let mut removed = 0;
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if is_spiral_metadata_backup(path) {
            removed += remove_backup(path)?;
        }
    }

    Ok(removed)
}

fn purge_backups_in_dir(dir: &Path) -> Result<usize, String> {
    if !dir.is_dir() {
        return Ok(0);
    }

    let mut removed = 0;
    let entries =
        fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {e}", dir.display()))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        if is_spiral_metadata_backup(&path) {
            removed += remove_backup(&path)?;
        }
    }

    Ok(removed)
}

fn remove_backup(path: &Path) -> Result<usize, String> {
    fs::remove_file(path)
        .map_err(|e| format!("Failed to remove leftover backup {}: {e}", path.display()))?;
    Ok(1)
}

/// Delete leftover sidecar tag backups under the media folder and next to
/// referenced tracks outside it.
pub fn purge_legacy_tag_backups(app: &AppHandle) -> Result<(), String> {
    let library = settings::resolved_library_settings(app);
    let media_folder = PathBuf::from(&library.media_folder);

    purge_backups_under(&media_folder)?;

    let conn = db::open(Path::new(&library.database_path))
        .map_err(|e| format!("Failed to open database for leftover backup cleanup: {e}"))?;
    let file_paths = db::list_file_paths(&conn)
        .map_err(|e| format!("Failed to list tracks for leftover backup cleanup: {e}"))?;

    let mut seen_parents = HashSet::new();
    for file_path in file_paths {
        let track_path = PathBuf::from(&file_path);
        let Some(parent) = track_path.parent() else {
            continue;
        };
        if parent.starts_with(&media_folder) {
            continue;
        }
        if !seen_parents.insert(parent.to_path_buf()) {
            continue;
        }
        purge_backups_in_dir(parent)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_spiral_backup_names() {
        assert!(is_spiral_metadata_backup(Path::new("/a/song.m4a.bak")));
        assert!(is_spiral_metadata_backup(Path::new("/a/song.mp4.bak")));
        assert!(is_spiral_metadata_backup(Path::new("track.mp3.bak")));
        assert!(is_spiral_metadata_backup(Path::new("track.wav.bak")));
        assert!(is_spiral_metadata_backup(Path::new("track.ogg.bak")));
        assert!(!is_spiral_metadata_backup(Path::new("notes.bak")));
        assert!(!is_spiral_metadata_backup(Path::new("song.m4a")));
    }

    #[test]
    fn purge_removes_all_leftover_backups() {
        let dir = std::env::temp_dir().join(format!("spiral-bak-purge-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let bak = dir.join("x.m4a.bak");
        fs::File::create(&bak).unwrap();
        fs::File::create(dir.join("keep.m4a")).unwrap();

        assert_eq!(purge_backups_in_dir(&dir).unwrap(), 1);
        assert!(!bak.exists());
        assert!(dir.join("keep.m4a").exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
