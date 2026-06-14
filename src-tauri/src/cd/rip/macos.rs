//! Rip CD tracks to FLAC/MP3 via cddafs AIFF + macOS `afconvert`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::cd::aiff_path::find_track_aiff_path;
use crate::cd::platform::session::{begin_phase, DriveSessionPhase};
use crate::library_organize::sanitize_filename;
use crate::metadata_backup::MetadataBackupConfig;
use crate::metadata_writer;
use crate::models::TrackMetadataUpdate;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RipFormat {
    Flac,
    Mp3,
}

impl RipFormat {
    pub fn from_str(value: &str) -> Result<Self, String> {
        match value.to_ascii_lowercase().as_str() {
            "flac" => Ok(Self::Flac),
            "mp3" => Ok(Self::Mp3),
            other => Err(format!("Unsupported rip format: {other}")),
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Flac => "flac",
            Self::Mp3 => "mp3",
        }
    }
}

pub fn rip_cd_track(
    drive_id: &str,
    track_number: u32,
    format: RipFormat,
    metadata: &TrackMetadataUpdate,
) -> Result<String, String> {
    let _guard = begin_phase(drive_id, DriveSessionPhase::Ripping);

    let source = find_track_aiff_path(drive_id, track_number)?;
    let dest = rip_output_path(drive_id, track_number, metadata, format)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("Failed to create rip folder: {err}"))?;
    }

    transcode_aiff(&source, &dest, format)?;

    let backup_config = MetadataBackupConfig {
        enabled: false,
        retention_days: 14,
    };
    metadata_writer::write_track_metadata(&dest, metadata, &backup_config)
        .map_err(|err| err.to_message())?;

    Ok(dest.to_string_lossy().into_owned())
}

pub fn cleanup_rip_temp(drive_id: &str) {
    let dir = rip_temp_dir(drive_id);
    if dir.exists() {
        let _ = fs::remove_dir_all(dir);
    }
}

fn rip_temp_dir(drive_id: &str) -> PathBuf {
    std::env::temp_dir()
        .join("spiral-rip")
        .join(sanitize_filename(drive_id))
}

fn rip_output_path(
    drive_id: &str,
    track_number: u32,
    metadata: &TrackMetadataUpdate,
    format: RipFormat,
) -> Result<PathBuf, String> {
    let title = sanitize_filename(metadata.title.trim());
    let safe_title = if title.is_empty() {
        format!("Track {track_number}")
    } else {
        title
    };
    let file_name = format!("{track_number:02} - {safe_title}.{}", format.extension());
    Ok(rip_temp_dir(drive_id).join(file_name))
}

fn transcode_aiff(source: &Path, dest: &Path, format: RipFormat) -> Result<(), String> {
    let mut command = Command::new("afconvert");
    command.arg(source).arg(dest);

    match format {
        RipFormat::Flac => {
            command.args(["-f", "flac", "-d", "flac"]);
        }
        RipFormat::Mp3 => {
            command.args(["-f", "MPG3", "-d", ".mp3"]);
        }
    }

    let output = command
        .output()
        .map_err(|err| format!("Failed to run afconvert: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "afconvert failed for {}: {stderr}",
            source.display()
        ));
    }

    if !dest.is_file() {
        return Err(format!("Rip output missing: {}", dest.display()));
    }

    Ok(())
}
