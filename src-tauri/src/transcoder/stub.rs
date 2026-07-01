use std::path::Path;

use crate::encoding_profiles;
use crate::metadata_backup::MetadataBackupConfig;
use crate::metadata_writer;
use crate::models::TrackMetadataUpdate;

use super::alac;

const STUB_MESSAGE: &str = "Audio transcoding is only supported on macOS";

pub fn transcode_file_with_metadata(
    source: &Path,
    dest: &Path,
    profile_id: &str,
    metadata: &TrackMetadataUpdate,
    backup_config: &MetadataBackupConfig,
) -> Result<(), String> {
    if !encoding_profiles::profile_is_alac(profile_id) {
        return Err(STUB_MESSAGE.into());
    }

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create output folder: {err}"))?;
    }

    alac::transcode_file_to_alac(source, dest)?;

    metadata_writer::write_track_metadata(dest, metadata, backup_config)
        .map_err(|err| err.to_message())
}
