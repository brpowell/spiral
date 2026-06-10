use crate::cd::platform;
use crate::cd::playback;
use crate::cd::playback::CdPlaybackStarted;
use crate::cd::types::{CdDisc, CdDiscCdText, CdDrive};
use tauri::AppHandle;

#[tauri::command]
pub async fn list_cd_drives() -> Result<Vec<CdDrive>, String> {
    tauri::async_runtime::spawn_blocking(platform::list_drives)
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn probe_cd_drive(drive_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || platform::probe_disc_presence(&drive_id))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn get_disc_info(drive_id: String) -> Result<Option<CdDisc>, String> {
    tauri::async_runtime::spawn_blocking(move || platform::get_disc_info(&drive_id))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn get_disc_cdtext(drive_id: String) -> Result<Option<CdDiscCdText>, String> {
    tauri::async_runtime::spawn_blocking(move || platform::get_disc_cdtext(&drive_id))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn eject_cd_disc(drive_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || platform::eject_disc(&drive_id))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn set_cd_detail_drive(drive_id: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        platform::set_detail_view_drive(drive_id.as_deref());
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn start_cd_playback(
    app: AppHandle,
    drive_id: String,
    track_number: u32,
) -> Result<CdPlaybackStarted, String> {
    tauri::async_runtime::spawn_blocking(move || playback::start(app, &drive_id, track_number))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn pause_cd_playback() {
    playback::pause();
}

#[tauri::command]
pub fn resume_cd_playback() {
    playback::resume();
}

#[tauri::command]
pub fn seek_cd_playback(position_seconds: f64) -> Result<(), String> {
    playback::seek(position_seconds)
}

#[tauri::command]
pub fn stop_cd_playback() {
    playback::stop();
}

#[tauri::command]
pub fn ack_cd_playback_pcm(count: u32) {
    playback::ack_pcm_chunks(count);
}
