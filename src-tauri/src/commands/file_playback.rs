use crate::file_playback::{self, FilePlaybackStarted};
use tauri::AppHandle;

#[tauri::command]
pub fn start_file_playback(app: AppHandle, path: String) -> Result<FilePlaybackStarted, String> {
    file_playback::start(app, &path)
}

#[tauri::command]
pub fn pause_file_playback() {
    file_playback::pause();
}

#[tauri::command]
pub fn resume_file_playback() {
    file_playback::resume();
}

#[tauri::command]
pub fn seek_file_playback(position_seconds: f64) -> Result<(), String> {
    file_playback::seek(position_seconds)
}

#[tauri::command]
pub fn stop_file_playback() {
    file_playback::stop();
}

#[tauri::command]
pub fn ack_file_playback_pcm(count: u32) {
    file_playback::ack_pcm_chunks(count);
}
