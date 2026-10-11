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
