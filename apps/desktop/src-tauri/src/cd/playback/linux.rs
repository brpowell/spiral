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

pub fn pause(session_id: u64) {
    engine::pause(session_id);
}

pub fn resume(session_id: u64) {
    engine::resume(session_id);
}

pub fn seek(session_id: u64, seconds: f64) -> Result<(), String> {
    engine::seek(session_id, seconds)
}

pub fn ack_pcm_chunks(session_id: u64, count: u32) {
    engine::ack_pcm_chunks(session_id, count);
}

pub fn stop(session_id: u64) {
    engine::stop(session_id);
}

pub fn stop_for_drive(drive_id: &str) {
    let id = normalize_drive_id(drive_id).unwrap_or_else(|| drive_id.to_string());
    engine::stop_for_drive(&id);
}
