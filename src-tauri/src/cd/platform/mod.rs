#[cfg(target_os = "macos")]
mod disc_recording;

#[cfg(target_os = "macos")]
pub(crate) mod session;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(not(target_os = "macos"))]
mod stub;

#[cfg(target_os = "macos")]
pub use macos::{
    cached_disc_presence, eject_disc, get_disc_cdtext, get_disc_info, is_drive_busy,
    is_optical_disc_volume, list_drives, list_drives_try, note_device_status_changed,
    note_volume_mounted, note_volume_unmounted, probe_disc_presence, probe_disc_presence_try,
    set_detail_view_drive, should_skip_monitor_probe,
};

#[cfg(target_os = "macos")]
pub(crate) use macos::mounted_volume_path;

#[cfg(not(target_os = "macos"))]
pub use stub::{
    cached_disc_presence, eject_disc, get_disc_cdtext, get_disc_info, is_drive_busy,
    is_optical_disc_volume, list_drives, list_drives_try, note_device_status_changed,
    note_volume_mounted, note_volume_unmounted, probe_disc_presence, probe_disc_presence_try,
    set_detail_view_drive, should_skip_monitor_probe,
};
