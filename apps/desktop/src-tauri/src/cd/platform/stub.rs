use crate::cd::types::{CdDisc, CdDiscCdText, CdDrive};

pub fn list_drives() -> Result<Vec<CdDrive>, String> {
    Ok(Vec::new())
}

pub fn probe_disc_presence(_drive_id: &str) -> Result<bool, String> {
    Ok(false)
}

pub fn is_drive_busy() -> bool {
    false
}

pub fn eject_disc(_drive_id: &str) -> Result<(), String> {
    Err("CD eject is not supported on this platform".into())
}

pub fn get_disc_info(_drive_id: &str) -> Result<Option<CdDisc>, String> {
    Ok(None)
}

pub fn get_disc_cdtext(_drive_id: &str) -> Result<Option<CdDiscCdText>, String> {
    Ok(None)
}

pub fn list_drives_try() -> Option<Result<Vec<CdDrive>, String>> {
    Some(list_drives())
}

pub fn probe_disc_presence_try(_drive_id: &str) -> Option<Result<bool, String>> {
    Some(Ok(false))
}

pub fn should_skip_monitor_probe(_drive_id: &str) -> bool {
    false
}

pub fn cached_disc_presence(_drive_id: &str) -> Option<bool> {
    None
}

pub fn set_detail_view_drive(_drive_id: Option<&str>) {}

pub fn is_optical_disc_volume(_volume_path: &str) -> bool {
    false
}

pub fn note_volume_mounted(_volume_path: &str) {}

pub fn note_volume_unmounted(_volume_path: &str) -> bool {
    false
}

pub fn note_device_status_changed() {}

pub fn prune_missing_drive_sessions(_drives: &[CdDrive]) -> bool {
    false
}
