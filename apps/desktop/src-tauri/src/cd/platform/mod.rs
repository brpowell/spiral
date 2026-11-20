#[cfg(target_os = "macos")]
mod disc_recording;

pub(crate) mod session;

mod disc;

/// MMC CD-Text pack parser (Windows IOCTL + Linux SG_IO).
#[cfg(any(target_os = "windows", target_os = "linux"))]
mod cd_text_packs;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
pub(crate) mod windows;

#[cfg(target_os = "linux")]
pub(crate) mod linux;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod stub;

/// Resolve the drive an eject request names, refusing anything that is not an optical drive.
///
/// Eject is reachable from the webview, and the Windows path force-dismounts the volume, so a
/// USB stick or data disk must never get past this point. Runs before any side effect.
#[cfg(any(target_os = "windows", target_os = "macos", test))]
pub(crate) fn resolve_ejectable_drive(
    drive_id: &str,
    normalize: impl FnOnce(&str) -> Option<String>,
    is_optical: impl FnOnce(&str) -> bool,
) -> Result<String, String> {
    let id = normalize(drive_id).ok_or_else(|| format!("Invalid drive id: {drive_id}"))?;
    if !is_optical(&id) {
        return Err(format!("Not an optical drive: {id}"));
    }
    Ok(id)
}

#[cfg(target_os = "macos")]
pub use macos::{
    cached_disc_presence, eject_disc, get_disc_cdtext, get_disc_info, is_drive_busy,
    is_optical_disc_volume, list_drives, list_drives_try, note_device_status_changed,
    note_volume_mounted, note_volume_unmounted, probe_disc_presence, probe_disc_presence_try,
    prune_missing_drive_sessions, set_detail_view_drive, should_skip_monitor_probe,
};

#[cfg(target_os = "macos")]
pub(crate) use macos::{mounted_volume_path, optical_drive_connected};

#[cfg(target_os = "windows")]
pub use windows::{
    cached_disc_presence, eject_disc, get_disc_cdtext, get_disc_info, is_drive_busy,
    is_optical_disc_volume, list_drives, list_drives_try, note_device_status_changed,
    note_volume_mounted, note_volume_unmounted, probe_disc_presence, probe_disc_presence_try,
    prune_missing_drive_sessions, set_detail_view_drive, should_skip_monitor_probe,
};

#[cfg(target_os = "windows")]
pub(crate) use windows::{open_drive_handle, read_track_bounds, with_drive_lock, TrackBounds};

#[cfg(target_os = "linux")]
pub use linux::{
    cached_disc_presence, eject_disc, get_disc_cdtext, get_disc_info, is_drive_busy,
    is_optical_disc_volume, list_drives, list_drives_try, note_device_status_changed,
    note_volume_mounted, note_volume_unmounted, probe_disc_presence, probe_disc_presence_try,
    prune_missing_drive_sessions, set_detail_view_drive, should_skip_monitor_probe,
};

#[cfg(target_os = "linux")]
pub(crate) use linux::{
    open_drive_handle, read_cdda_sectors, read_track_bounds, with_drive_lock, TrackBounds,
};

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub use stub::{
    cached_disc_presence, eject_disc, get_disc_cdtext, get_disc_info, is_drive_busy,
    is_optical_disc_volume, list_drives, list_drives_try, note_device_status_changed,
    note_volume_mounted, note_volume_unmounted, probe_disc_presence, probe_disc_presence_try,
    prune_missing_drive_sessions, set_detail_view_drive, should_skip_monitor_probe,
};

#[cfg(test)]
mod tests {
    use super::resolve_ejectable_drive;

    fn some_trimmed(id: &str) -> Option<String> {
        let id = id.trim();
        (!id.is_empty()).then(|| id.to_string())
    }

    #[test]
    fn eject_accepts_optical_drive() {
        let resolved = resolve_ejectable_drive(" D: ", some_trimmed, |id| id == "D:");
        assert_eq!(resolved, Ok("D:".to_string()));
    }

    #[test]
    fn eject_refuses_non_optical_drive() {
        let resolved = resolve_ejectable_drive("C:", some_trimmed, |_| false);
        assert_eq!(resolved, Err("Not an optical drive: C:".to_string()));
    }

    #[test]
    fn eject_refuses_invalid_id_without_probing() {
        let resolved = resolve_ejectable_drive("  ", some_trimmed, |_| {
            panic!("optical check must not run for an invalid id")
        });
        assert_eq!(resolved, Err("Invalid drive id:   ".to_string()));
    }

    #[test]
    fn eject_checks_the_normalized_id() {
        let mut probed = None;
        let resolved = resolve_ejectable_drive(
            r"\\.\e:",
            |_| Some("E:".to_string()),
            |id| {
                probed = Some(id.to_string());
                true
            },
        );
        assert_eq!(resolved, Ok("E:".to_string()));
        assert_eq!(probed.as_deref(), Some("E:"));
    }
}
