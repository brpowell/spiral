use crate::skin_preferences::{self, SkinUserPreferences};
use tauri::AppHandle;

#[tauri::command]
pub fn get_skin_preferences(
    app: AppHandle,
    skin_id: String,
) -> Result<SkinUserPreferences, String> {
    Ok(skin_preferences::read_preferences(&app, &skin_id))
}

#[tauri::command]
pub fn save_skin_preferences(
    app: AppHandle,
    skin_id: String,
    preferences: SkinUserPreferences,
) -> Result<(), String> {
    skin_preferences::write_preferences(&app, &skin_id, &preferences)
}
