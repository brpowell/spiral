//! CD playback stub for platforms without optical support.
#![cfg(not(any(target_os = "macos", target_os = "windows")))]

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

#[allow(dead_code)]
pub fn stop_for_drive(_drive_id: &str) {}
