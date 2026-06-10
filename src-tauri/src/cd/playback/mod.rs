//! Native CD audio playback.
//!
//! macOS mounts audio CDs via cddafs as one AIFF file per track; the engine
//! reads that file, decodes CD-DA PCM, and streams f32 chunks to the frontend
//! Web Audio pipeline. Position / end / error updates reach the frontend as
//! Tauri events.

use serde::Serialize;

pub const CD_PLAYBACK_POSITION_EVENT: &str = "cd-playback-position";
pub const CD_PLAYBACK_ENDED_EVENT: &str = "cd-playback-ended";
pub const CD_PLAYBACK_ERROR_EVENT: &str = "cd-playback-error";
pub const CD_PLAYBACK_PCM_EVENT: &str = "cd-playback-pcm";
pub const CD_PLAYBACK_FLUSH_EVENT: &str = "cd-playback-flush";

/// Reply to `start_cd_playback` — playback begins paused.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdPlaybackStarted {
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub channels: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdPlaybackPosition {
    pub drive_id: String,
    pub track_number: u32,
    pub position_seconds: f64,
    pub duration_seconds: f64,
    pub is_playing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdPlaybackEnded {
    pub drive_id: String,
    pub track_number: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdPlaybackError {
    pub drive_id: String,
    pub track_number: u32,
    pub message: String,
}

/// One batched PCM chunk — base64 little-endian f32, interleaved channels.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdPlaybackPcm {
    pub drive_id: String,
    pub track_number: u32,
    pub channels: u16,
    pub pcm_b64: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdPlaybackFlush {
    pub drive_id: String,
    pub track_number: u32,
}

#[cfg(target_os = "macos")]
mod aiff;
#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub use macos::{ack_pcm_chunks, pause, resume, seek, start, stop, stop_for_drive};

#[cfg(not(target_os = "macos"))]
mod stub;

#[cfg(not(target_os = "macos"))]
pub use stub::{ack_pcm_chunks, pause, resume, seek, start, stop, stop_for_drive};
