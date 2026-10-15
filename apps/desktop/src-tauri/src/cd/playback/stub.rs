//! CD playback stub for platforms without optical support.
#![cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]

use super::CdPlaybackStarted;
use tauri::AppHandle;

pub fn start(
    _app: AppHandle,
    _drive_id: &str,
    _track_number: u32,
    _native: bool,
) -> Result<CdPlaybackStarted, String> {
    Err("CD playback is not supported on this platform".into())
}

pub fn set_gain(_session_id: u64, _gain: f32) {}

pub fn set_balance(_session_id: u64, _balance: f32) {}

pub fn ramp_gain(_session_id: u64, _from: f32, _to: f32, _duration_ms: u32) {}

pub fn link_gapless(_from_session: u64, _to_session: u64) -> Result<(), String> {
    Err("CD playback is not supported on this platform".into())
}

pub fn pause(_session_id: u64) {}

pub fn resume(_session_id: u64) {}

pub fn seek(_session_id: u64, _seconds: f64) -> Result<(), String> {
    Ok(())
}

pub fn ack_pcm_chunks(_session_id: u64, _count: u32) {}

pub fn stop(_session_id: u64) {}

#[allow(dead_code)]
pub fn stop_for_drive(_drive_id: &str) {}
