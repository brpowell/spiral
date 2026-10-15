//! CD playback for macOS: cddafs AIFF file → shared PCM engine.
#![cfg(target_os = "macos")]

use tauri::AppHandle;

use super::aiff::AiffSource;
use super::engine;
use super::CdPlaybackStarted;
use crate::cd::aiff_path::find_track_aiff_path;
use crate::cd::platform::session::{begin_phase, DriveSessionPhase};
use crate::transcoder::PcmStream;

pub fn start(
    app: AppHandle,
    drive_id: &str,
    track_number: u32,
    native: bool,
) -> Result<CdPlaybackStarted, String> {
    // Hold Playing before path resolution so the brief gap between tracks does
    // not return Idle and let background disc reads block auto-advance.
    let session_guard = begin_phase(drive_id, DriveSessionPhase::Playing);

    let track_path = find_track_aiff_path(drive_id, track_number)?;
    let source = AiffSource::open(&track_path)?;
    engine::start(
        app,
        drive_id,
        track_number,
        source,
        Some(session_guard),
        native,
    )
}

/// Read an entire cddafs track as interleaved PCM for ripping.
pub fn read_track_pcm(drive_id: &str, track_number: u32) -> Result<PcmStream, String> {
    let track_path = find_track_aiff_path(drive_id, track_number)?;
    AiffSource::read_pcm(&track_path)
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

pub fn ack_pcm_chunks(session_id: u64, count: u32) {
    engine::ack_pcm_chunks(session_id, count);
}

pub fn stop(session_id: u64) {
    engine::stop(session_id);
}

pub fn stop_for_drive(drive_id: &str) {
    engine::stop_for_drive(drive_id);
}
