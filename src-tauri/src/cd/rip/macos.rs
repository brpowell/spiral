//! Rip CD tracks to FLAC/MP3 via cddafs AIFF + macOS `afconvert`.

use std::fs;
use std::path::PathBuf;

use crate::cd::aiff_path::find_track_aiff_path;
use crate::cd::platform::session::{begin_phase, DriveSessionPhase};
use crate::encoding_profiles;
use crate::library_organize::sanitize_filename;
use crate::metadata_backup::MetadataBackupConfig;
use crate::models::TrackMetadataUpdate;
use crate::transcoder;

pub fn rip_cd_track(
    drive_id: &str,
    track_number: u32,
    profile_id: &str,
    metadata: &TrackMetadataUpdate,
) -> Result<String, String> {
    let profile = encoding_profiles::profile_from_id(profile_id)?;
    let _guard = begin_phase(drive_id, DriveSessionPhase::Ripping);

    let source = find_track_aiff_path(drive_id, track_number)?;
    let dest = rip_output_path(drive_id, track_number, metadata, profile.extension)?;
    let backup_config = MetadataBackupConfig {
        enabled: false,
        retention_days: 14,
    };

    transcoder::transcode_file_with_metadata(
        &source,
        &dest,
        profile_id,
        metadata,
        &backup_config,
    )?;

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
