//! Native CD audio playback.
//!
//! Platforms supply a PCM source (macOS: cddafs AIFF; Windows/Linux: raw CD-DA sectors).
//! The shared engine feeds the native audio output (see `native_audio`).
//! Position / end / error updates reach the frontend as Tauri events.

use serde::Serialize;

pub const CD_PLAYBACK_POSITION_EVENT: &str = "cd-playback-position";
pub const CD_PLAYBACK_ENDED_EVENT: &str = "cd-playback-ended";
pub const CD_PLAYBACK_ERROR_EVENT: &str = "cd-playback-error";
/// A native session began playing on its own (gapless splice from another session).
pub const CD_PLAYBACK_GAPLESS_STARTED_EVENT: &str = "cd-playback-gapless-started";

/// Reply to `start_cd_playback` — playback begins paused.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdPlaybackStarted {
    pub session_id: u64,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub channels: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdPlaybackPosition {
    pub session_id: u64,
    pub drive_id: String,
    pub track_number: u32,
    pub position_seconds: f64,
    pub duration_seconds: f64,
    pub is_playing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdPlaybackEnded {
    pub session_id: u64,
    pub drive_id: String,
    pub track_number: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdPlaybackError {
    pub session_id: u64,
    pub drive_id: String,
    pub track_number: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdPlaybackGaplessStarted {
    pub session_id: u64,
    pub drive_id: String,
    pub track_number: u32,
}

mod engine;
mod source;

#[cfg(target_os = "macos")]
mod aiff;
#[cfg(target_os = "macos")]
mod macos;

#[cfg(any(target_os = "windows", target_os = "linux"))]
mod cdda;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod stub;

#[cfg(target_os = "macos")]
pub use macos::{
    link_gapless, pause, ramp_gain, read_track_pcm, resume, seek, set_balance, set_gain, start,
    stop, stop_for_drive,
};

#[cfg(target_os = "windows")]
pub use windows::{
    link_gapless, pause, ramp_gain, resume, seek, set_balance, set_gain, start, stop,
    stop_for_drive,
};

#[cfg(target_os = "windows")]
pub use cdda::read_track_pcm;

#[cfg(target_os = "linux")]
pub use linux::{
    link_gapless, pause, ramp_gain, resume, seek, set_balance, set_gain, start, stop,
    stop_for_drive,
};

#[cfg(target_os = "linux")]
pub use cdda::read_track_pcm;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
#[allow(unused_imports)]
pub use stub::{
    link_gapless, pause, ramp_gain, resume, seek, set_balance, set_gain, start, stop,
    stop_for_drive,
};
