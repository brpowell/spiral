use crate::settings::{self, PlaybackSettings};
use tauri::AppHandle;

#[tauri::command]
pub fn get_playback_settings(app: AppHandle) -> Result<PlaybackSettings, String> {
    Ok(settings::read_settings(&app).playback)
}

#[tauri::command]
pub fn save_playback_settings(
    app: AppHandle,
    settings: PlaybackSettings,
) -> Result<(), String> {
    let mut app_settings = settings::read_settings(&app);
    app_settings.playback = settings::normalize_playback_settings(settings);
    settings::write_settings(&app, &app_settings)
}
