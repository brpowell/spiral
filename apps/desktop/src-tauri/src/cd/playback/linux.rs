//! CD playback for Linux: raw CD-DA sectors → shared PCM engine.
#![cfg(target_os = "linux")]

use tauri::AppHandle;

use super::cdda::CddaTrackSource;
use super::engine;
use super::CdPlaybackStarted;
use crate::cd::platform::linux::normalize_drive_id;
use crate::cd::platform::session::{begin_phase, DriveSessionPhase};

pub fn start(
    app: AppHandle,
    drive_id: &str,
    track_number: u32,
) -> Result<CdPlaybackStarted, String> {
    let drive_id =
        normalize_drive_id(drive_id).ok_or_else(|| format!("Invalid drive id: {drive_id}"))?;

    // Hold Playing before sector setup so background TOC probes defer.
    let session_guard = begin_phase(&drive_id, DriveSessionPhase::Playing);

    let source = CddaTrackSource::open(&drive_id, track_number)?;
    engine::start(app, &drive_id, track_number, source, Some(session_guard))
}

pub fn set_gain(session_id: u64, gain: f32) {
    engine::set_gain(session_id, gain);
}

pub fn set_balance(session_id: u64, balance: f32) {
    engine::set_balance(session_id, balance);
}

pub fn ramp_gain(session_id: u64, from: f32, to: f32, duration_ms: u32) {
    engine::ramp_gain(session_id, from, to, duration_ms);
}

pub fn link_gapless(from_session: u64, to_session: u64) -> Result<(), String> {
    engine::link_gapless(from_session, to_session)
}

pub fn pause(session_id: u64) {
    engine::pause(session_id);
}

pub fn resume(session_id: u64) {
    engine::resume(session_id);
}

pub fn seek(session_id: u64, seconds: f64) -> Result<(), String> {
    engine::seek(session_id, seconds)
}

pub fn stop(session_id: u64) {
    engine::stop(session_id);
}

pub fn stop_for_drive(drive_id: &str) {
    let id = normalize_drive_id(drive_id).unwrap_or_else(|| drive_id.to_string());
    engine::stop_for_drive(&id);
}
