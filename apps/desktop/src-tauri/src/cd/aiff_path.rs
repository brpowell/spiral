//! Resolve cddafs-mounted AIFF paths for CD tracks.
#![cfg(target_os = "macos")]

use std::path::{Path, PathBuf};

use crate::cd::platform;

pub fn find_track_aiff_path(drive_id: &str, track_number: u32) -> Result<PathBuf, String> {
    let volume_path = platform::mounted_volume_path(drive_id).ok_or_else(|| {
        if platform::optical_drive_connected(drive_id) {
            "No audio CD in drive".to_string()
        } else {
            "Disc drive disconnected".to_string()
        }
    })?;
    find_track_file(Path::new(&volume_path), track_number)
}

/// cddafs names tracks like `1 Audio Track.aiff` — the leading integer is the track number.
fn find_track_file(volume: &Path, track_number: u32) -> Result<PathBuf, String> {
    let entries = std::fs::read_dir(volume)
        .map_err(|err| format!("Failed to read CD volume {}: {err}", volume.display()))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
            continue;
        };
        if !matches!(ext.to_ascii_lowercase().as_str(), "aiff" | "aif" | "aifc") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        let leading: String = stem.chars().take_while(char::is_ascii_digit).collect();
        if leading.parse::<u32>() == Ok(track_number) {
            return Ok(path);
        }
    }

    Err(format!("Track {track_number} not found on disc"))
}
