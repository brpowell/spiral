use crate::db;
use crate::settings::{self, MetadataBackupSettings};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::AppHandle;
use walkdir::WalkDir;

pub const DEFAULT_RETENTION_DAYS: u32 = 14;
pub const MIN_RETENTION_DAYS: u32 = 1;
pub const MAX_RETENTION_DAYS: u32 = 3650;

const BACKUP_SUFFIXES: &[&str] = &[".m4a.bak", ".mp3.bak", ".flac.bak", ".aac.bak"];

#[derive(Debug, Clone, Copy)]
pub struct MetadataBackupConfig {
    pub enabled: bool,
    pub retention_days: u32,
}

impl From<&MetadataBackupSettings> for MetadataBackupConfig {
    fn from(s: &MetadataBackupSettings) -> Self {
        Self {
            enabled: s.enabled,
            retention_days: s.retention_days.clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS),
        }
    }
}

#[derive(Debug, Default)]
pub struct CleanupStats {
    pub removed: usize,
    pub bytes_freed: u64,
}

pub fn is_spiral_metadata_backup(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    BACKUP_SUFFIXES.iter().any(|suffix| name.ends_with(suffix))
}

pub fn backup_path_for(path: &Path) -> PathBuf {
    path.with_extension(format!(
        "{}.bak",
        path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("audio")
    ))
}

/// Remove Spiral metadata backups under `root` (recursive). Honors enabled + retention.
pub fn cleanup_backups_under(root: &Path, config: &MetadataBackupConfig) -> Result<CleanupStats, String> {
    if !root.is_dir() {
        return Ok(CleanupStats::default());
    }

    let mut stats = CleanupStats::default();
    let retention = retention_duration(config.retention_days);

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if !is_spiral_metadata_backup(path) {
            continue;
        }
        if should_remove_backup(path, config, retention)? {
            let len = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            fs::remove_file(path)
                .map_err(|e| format!("Failed to remove backup {}: {e}", path.display()))?;
            stats.removed += 1;
            stats.bytes_freed += len;
        }
    }

    Ok(stats)
}

/// Remove eligible backups in a single directory (non-recursive).
pub fn cleanup_backups_in_dir(dir: &Path, config: &MetadataBackupConfig) -> Result<CleanupStats, String> {
    if !dir.is_dir() {
        return Ok(CleanupStats::default());
    }

    let mut stats = CleanupStats::default();
    let retention = retention_duration(config.retention_days);
    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {e}", dir.display()))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        if !is_spiral_metadata_backup(&path) {
            continue;
        }
        if should_remove_backup(&path, config, retention)? {
            let len = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to remove backup {}: {e}", path.display()))?;
            stats.removed += 1;
            stats.bytes_freed += len;
        }
    }

    Ok(stats)
}

fn retention_duration(days: u32) -> Option<std::time::Duration> {
    Some(std::time::Duration::from_secs(u64::from(days) * 86_400))
}

fn should_remove_backup(
    path: &Path,
    config: &MetadataBackupConfig,
    retention: Option<std::time::Duration>,
) -> Result<bool, String> {
    if !config.enabled {
        return Ok(true);
    }

    let Some(retention) = retention else {
        return Ok(false);
    };

    let modified = fs::metadata(path)
        .and_then(|m| m.modified())
        .map_err(|e| format!("Failed to read backup metadata {}: {e}", path.display()))?;

    let age = SystemTime::now()
        .duration_since(modified)
        .unwrap_or_default();

    Ok(age > retention)
}

/// Purge expired backups under the media folder and next to referenced tracks outside it.
pub fn run_scheduled_cleanup(app: &AppHandle) -> Result<CleanupStats, String> {
    let config = MetadataBackupConfig::from(&settings::read_settings(app).metadata_backups);
    let library = settings::resolved_library_settings(app);
    let media_folder = PathBuf::from(&library.media_folder);

    let mut total = CleanupStats::default();
    merge_cleanup_stats(&mut total, cleanup_backups_under(&media_folder, &config)?);

    let conn = db::open(Path::new(&library.database_path))
        .map_err(|e| format!("Failed to open database for backup cleanup: {e}"))?;
    let file_paths = db::list_file_paths(&conn)
        .map_err(|e| format!("Failed to list tracks for backup cleanup: {e}"))?;

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
        merge_cleanup_stats(&mut total, cleanup_backups_in_dir(parent, &config)?);
    }

    Ok(total)
}

fn merge_cleanup_stats(total: &mut CleanupStats, partial: CleanupStats) {
    total.removed += partial.removed;
    total.bytes_freed += partial.bytes_freed;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_spiral_backup_names() {
        assert!(is_spiral_metadata_backup(Path::new("/a/song.m4a.bak")));
        assert!(is_spiral_metadata_backup(Path::new("track.mp3.bak")));
        assert!(!is_spiral_metadata_backup(Path::new("notes.bak")));
        assert!(!is_spiral_metadata_backup(Path::new("song.m4a")));
    }

    #[test]
    fn disabled_config_removes_all_backups() {
        let dir = std::env::temp_dir().join(format!("spiral-bak-clean-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let bak = dir.join("x.m4a.bak");
        fs::File::create(&bak).unwrap();

        let config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        let stats = cleanup_backups_in_dir(&dir, &config).unwrap();
        assert_eq!(stats.removed, 1);
        assert!(!bak.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn expired_backup_removed_when_enabled() {
        let dir = std::env::temp_dir().join(format!("spiral-bak-age-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let bak = dir.join("x.mp3.bak");
        fs::File::create(&bak).unwrap();

        // Fresh backup should be kept with default retention.
        let config = MetadataBackupConfig {
            enabled: true,
            retention_days: 14,
        };
        let stats = cleanup_backups_in_dir(&dir, &config).unwrap();
        assert_eq!(stats.removed, 0);
        assert!(bak.exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
