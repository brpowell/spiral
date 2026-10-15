use crate::file_playback::{self, FilePlaybackStarted, PcmChannel};
use tauri::AppHandle;

#[tauri::command]
pub fn start_file_playback(
    app: AppHandle,
    path: String,
    pcm: PcmChannel,
) -> Result<FilePlaybackStarted, String> {
    file_playback::start(app, &path, Some(pcm), false)
}

/// Like `start_file_playback`, but audio is mixed in Rust and played through
/// the OS audio API, so the webview needs no PCM channel.
#[tauri::command]
pub fn start_native_file_playback(
    app: AppHandle,
    path: String,
) -> Result<FilePlaybackStarted, String> {
    file_playback::start(app, &path, None, true)
}

#[tauri::command]
pub fn pause_file_playback(session_id: u64) {
    file_playback::pause(session_id)
}

#[tauri::command]
pub fn resume_file_playback(session_id: u64) {
    file_playback::resume(session_id)
}

#[tauri::command]
pub fn seek_file_playback(session_id: u64, position_seconds: f64) -> Result<(), String> {
    file_playback::seek(session_id, position_seconds)
}

#[tauri::command]
pub fn stop_file_playback(session_id: u64) {
    file_playback::stop(session_id)
}

#[tauri::command]
pub fn ack_file_playback_pcm(session_id: u64, count: u32) {
    file_playback::ack_pcm_chunks(session_id, count)
}

/// Output gain (0–1) for a native session; volume and mute are folded together
/// by the caller.
#[tauri::command]
pub fn set_file_playback_gain(session_id: u64, gain: f32) {
    file_playback::set_gain(session_id, gain)
}

/// Start `to_session` on the exact sample `from_session` runs out (native only).
#[tauri::command]
pub fn link_gapless_playback(from_session: u64, to_session: u64) -> Result<(), String> {
    file_playback::link_gapless(from_session, to_session)
}
