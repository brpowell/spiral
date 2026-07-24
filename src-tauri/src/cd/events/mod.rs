/// Wakes the background CD monitor for a refresh.
#[derive(Debug, Clone)]
#[allow(dead_code)] // VolumeMounted/Unmounted are constructed on macOS; Windows uses DeviceStatusChanged.
pub enum MonitorWake {
    VolumeMounted { path: String },
    VolumeUnmounted { path: String },
    /// Optical media insert/eject/state change (no filesystem mount required).
    DeviceStatusChanged,
}

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
pub use macos::start_volume_events;

#[cfg(target_os = "windows")]
pub use windows::start_volume_events;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn start_volume_events(
    _tx: std::sync::mpsc::Sender<MonitorWake>,
) -> Result<(), String> {
    Ok(())
}
