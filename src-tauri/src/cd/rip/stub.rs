use crate::models::TrackMetadataUpdate;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RipFormat {
    Flac,
    Mp3,
}

impl RipFormat {
    pub fn from_str(_value: &str) -> Result<Self, String> {
        Err("CD ripping is only supported on macOS".into())
    }
}

pub fn rip_cd_track(
    _drive_id: &str,
    _track_number: u32,
    _format: RipFormat,
    _metadata: &TrackMetadataUpdate,
) -> Result<String, String> {
    Err("CD ripping is only supported on macOS".into())
}

pub fn cleanup_rip_temp(_drive_id: &str) {}
