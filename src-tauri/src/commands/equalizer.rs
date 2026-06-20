use crate::settings::{self, EqualizerPresetRecord, EqualizerSettings};
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
    app_settings.equalizer.enabled = settings.enabled;
    app_settings.equalizer.preset_id = settings.preset_id;
    app_settings.equalizer.bands = settings.bands;
    app_settings.equalizer.preamp_gain = settings.preamp_gain;
    settings::write_settings(&app, &app_settings)
}

#[tauri::command]
pub fn list_equalizer_custom_presets(
    app: AppHandle,
) -> Result<Vec<EqualizerPresetRecord>, String> {
    Ok(settings::read_settings(&app).equalizer.custom_presets)
}

#[tauri::command]
pub fn save_equalizer_custom_preset(
    app: AppHandle,
    preset: EqualizerPresetRecord,
) -> Result<(), String> {
    let mut app_settings = settings::read_settings(&app);
    if let Some(existing) = app_settings
        .equalizer
        .custom_presets
        .iter_mut()
        .find(|p| p.id == preset.id)
    {
        *existing = preset;
    } else {
        app_settings.equalizer.custom_presets.push(preset);
    }
    settings::write_settings(&app, &app_settings)
}

#[tauri::command]
pub fn delete_equalizer_custom_preset(app: AppHandle, id: String) -> Result<(), String> {
    let mut app_settings = settings::read_settings(&app);
    app_settings
        .equalizer
        .custom_presets
        .retain(|preset| preset.id != id);
    if app_settings.equalizer.preset_id == id {
        app_settings.equalizer.preset_id = "flat".to_string();
    }
    settings::write_settings(&app, &app_settings)
}
