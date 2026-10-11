use crate::models::TrackMetadataUpdate;

pub fn rip_cd_track(
    _drive_id: &str,
    _track_number: u32,
    _profile_id: &str,
    _metadata: &TrackMetadataUpdate,
) -> Result<String, String> {
    Err("CD ripping is not supported on this platform".into())
}
