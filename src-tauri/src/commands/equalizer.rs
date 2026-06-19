use crate::settings::{self, EqualizerSettings};
use tauri::AppHandle;

#[tauri::command]
pub fn get_equalizer_settings(app: AppHandle) -> Result<EqualizerSettings, String> {
    Ok(settings::read_settings(&app).equalizer)
}

#[tauri::command]
pub fn save_equalizer_settings(
    app: AppHandle,
    settings: EqualizerSettings,
) -> Result<(), String> {
    let mut app_settings = settings::read_settings(&app);
    app_settings.equalizer = settings;
    settings::write_settings(&app, &app_settings)
}
