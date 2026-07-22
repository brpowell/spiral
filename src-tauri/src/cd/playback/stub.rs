//! CD playback stub for non-macOS platforms.
#![cfg(not(target_os = "macos"))]

use super::CdPlaybackStarted;
use tauri::AppHandle;

pub fn start(
    _app: AppHandle,
    _drive_id: &str,
    _track_number: u32,
) -> Result<CdPlaybackStarted, String> {
    Err("CD playback is not supported on this platform".into())
}

pub fn pause() {}

pub fn resume() {}

pub fn seek(_seconds: f64) -> Result<(), String> {
    Ok(())
}

pub fn ack_pcm_chunks(_count: u32) {}

pub fn stop() {}

#[allow(dead_code)] // Called from macOS eject; kept for API parity on other platforms
pub fn stop_for_drive(_drive_id: &str) {}
