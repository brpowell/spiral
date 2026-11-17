use super::library::DbState;
use crate::genre_settings::{self, GenreBackground, GenreSettings};
use tauri::State;

#[tauri::command]
pub fn get_genre_settings(state: State<DbState>) -> Result<Vec<GenreSettings>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    genre_settings::get_all(&conn).map_err(|e| e.to_string())
}

/// Give every genre in `genre_keys` this background; None clears it.
#[tauri::command]
pub fn set_genre_backgrounds(
    state: State<DbState>,
    genre_keys: Vec<String>,
    background: Option<GenreBackground>,
) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    genre_settings::set_backgrounds(&mut conn, &genre_keys, background.as_ref())
}

/// Carry a genre's settings to its new key after a rename or merge.
#[tauri::command]
pub fn rename_genre_settings_key(
    state: State<DbState>,
    old_key: String,
    new_key: String,
) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    genre_settings::rename_key(&mut conn, &old_key, &new_key).map_err(|e| e.to_string())
}

/// One-time import of backgrounds an earlier version kept in local storage.
#[tauri::command]
pub fn import_genre_backgrounds(
    state: State<DbState>,
    backgrounds: Vec<(String, GenreBackground)>,
) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    genre_settings::import_backgrounds(&mut conn, &backgrounds)
}
