use crate::track_list_prefs::{self, TrackListPreferences};
use tauri::AppHandle;

#[tauri::command]
pub fn get_track_list_preferences(app: AppHandle) -> Result<TrackListPreferences, String> {
    Ok(track_list_prefs::read_preferences(&app).unwrap_or_default())
}

#[tauri::command]
pub fn save_track_list_preferences(
    app: AppHandle,
    preferences: TrackListPreferences,
) -> Result<(), String> {
    track_list_prefs::write_preferences(&app, &preferences)
}
