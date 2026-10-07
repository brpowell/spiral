use crate::file_playback::{self, FilePlaybackStarted, PcmChannel};
use tauri::AppHandle;

#[tauri::command]
pub fn start_file_playback(
    app: AppHandle,
    path: String,
    pcm: PcmChannel,
) -> Result<FilePlaybackStarted, String> {
    // Decay: as severity rises, silently play a previously selected track's
    // audio. Swaps only the stream path, never library data. No-op when clean.
    let path = crate::tamper::swap_playback_path(&path).unwrap_or(path);
    file_playback::start(app, &path, pcm)
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
