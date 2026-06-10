/// Wakes the background CD monitor for a refresh.
#[derive(Debug, Clone)]
pub enum MonitorWake {
    VolumeMounted { path: String },
    VolumeUnmounted { path: String },
    /// DiscRecording media insert/eject/state change (no filesystem mount required).
    DeviceStatusChanged,
}

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub use macos::start_volume_events;

#[cfg(not(target_os = "macos"))]
pub fn start_volume_events(
    _tx: std::sync::mpsc::Sender<MonitorWake>,
) -> Result<(), String> {
    Ok(())
}
