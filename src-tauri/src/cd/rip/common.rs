//! Shared CD rip: temp paths, PCM → profile encode + tags, and platform rip entry.

use std::fs;
use std::path::PathBuf;

use crate::library_organize::sanitize_filename;
use crate::models::TrackMetadataUpdate;

#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::cd::platform::session::{begin_phase, DriveSessionPhase};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::cd::playback::read_track_pcm;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::encoding_profiles;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::metadata_backup::MetadataBackupConfig;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::transcoder::{self, PcmStream};

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
    extension: &str,
) -> Result<PathBuf, String> {
    let title = sanitize_filename(metadata.title.trim());
    let safe_title = if title.is_empty() {
        format!("Track {track_number}")
    } else {
        title
    };
    let file_name = format!("{track_number:02} - {safe_title}.{extension}");
    Ok(rip_temp_dir(drive_id).join(file_name))
}

/// Encode CD-DA PCM with the given profile and write tags (no metadata backups).
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn encode_rip_pcm(
    pcm: &PcmStream,
    drive_id: &str,
    track_number: u32,
    profile_id: &str,
    metadata: &TrackMetadataUpdate,
) -> Result<PathBuf, String> {
    let profile = encoding_profiles::profile_from_id(profile_id)?;
    let dest = rip_output_path(drive_id, track_number, metadata, profile.extension)?;
    let backup_config = MetadataBackupConfig {
        enabled: false,
        retention_days: 14,
    };
    transcoder::encode_pcm_with_metadata(pcm, &dest, profile_id, metadata, &backup_config)?;
    Ok(dest)
}

/// Rip one track: platform `read_track_pcm` → shared encode.
///
/// macOS reads cddafs AIFF; Windows reads raw CD-DA sectors. Both feed the same encoder.
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn rip_cd_track(
    drive_id: &str,
    track_number: u32,
    profile_id: &str,
    metadata: &TrackMetadataUpdate,
) -> Result<String, String> {
    let _guard = begin_phase(drive_id, DriveSessionPhase::Ripping);

    let pcm = read_track_pcm(drive_id, track_number)?;
    let dest = encode_rip_pcm(&pcm, drive_id, track_number, profile_id, metadata)?;
    Ok(dest.to_string_lossy().into_owned())
}
