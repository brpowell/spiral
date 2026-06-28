use std::path::Path;

use crate::metadata_backup::MetadataBackupConfig;
use crate::models::TrackMetadataUpdate;

const STUB_MESSAGE: &str = "Audio transcoding is only supported on macOS";

pub fn transcode_file_with_metadata(
    _source: &Path,
    _dest: &Path,
    _profile_id: &str,
    _metadata: &TrackMetadataUpdate,
    _backup_config: &MetadataBackupConfig,
) -> Result<(), String> {
    Err(STUB_MESSAGE.into())
}
