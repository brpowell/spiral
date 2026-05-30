use super::library::DbState;
use crate::db;
use crate::models::ArtistImage;
use tauri::State;

#[tauri::command]
pub fn get_artist_images(state: State<DbState>) -> Result<Vec<ArtistImage>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_all_artist_images(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_artist_image(
    state: State<DbState>,
    artist_key: String,
    browse_mode: String,
    art_path: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::save_artist_image(&conn, &artist_key, &browse_mode, art_path.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_artist_image_key(
    state: State<DbState>,
    old_key: String,
    new_key: String,
    browse_mode: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::rename_artist_image_key(&conn, &old_key, &new_key, &browse_mode)
        .map_err(|e| e.to_string())
}
