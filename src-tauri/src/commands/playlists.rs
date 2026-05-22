use crate::db;
use crate::models::{Playlist, PlaylistImageMode};
use tauri::State;

use super::library::DbState;

#[tauri::command]
pub fn get_playlists(state: State<DbState>) -> Result<Vec<Playlist>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_all_playlists(&conn).map_err(|e| {
        eprintln!("get_playlists error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn create_playlist(
    state: State<DbState>,
    title: String,
    description: Option<String>,
    image_mode: PlaylistImageMode,
    custom_image_path: Option<String>,
) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::create_playlist(
        &conn,
        &title,
        description.as_deref(),
        image_mode,
        custom_image_path.as_deref(),
    )
    .map_err(|e| {
        eprintln!("create_playlist error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn update_playlist(
    state: State<DbState>,
    id: i64,
    title: String,
    description: Option<String>,
    image_mode: PlaylistImageMode,
    custom_image_path: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::update_playlist(
        &conn,
        id,
        &title,
        description.as_deref(),
        image_mode,
        custom_image_path.as_deref(),
    )
    .map_err(|e| {
        eprintln!("update_playlist error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn touch_playlist(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::touch_playlist(&conn, id).map_err(|e| {
        eprintln!("touch_playlist error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn add_tracks_to_playlist(
    state: State<DbState>,
    playlist_id: i64,
    track_ids: Vec<i64>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::add_tracks_to_playlist(&conn, playlist_id, &track_ids).map_err(|e| {
        eprintln!("add_tracks_to_playlist error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn remove_tracks_from_playlist(
    state: State<DbState>,
    playlist_id: i64,
    track_ids: Vec<i64>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::remove_tracks_from_playlist(&conn, playlist_id, &track_ids).map_err(|e| {
        eprintln!("remove_tracks_from_playlist error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn reorder_playlist_tracks(
    state: State<DbState>,
    playlist_id: i64,
    track_ids: Vec<i64>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::reorder_playlist_tracks(&conn, playlist_id, &track_ids).map_err(|e| {
        eprintln!("reorder_playlist_tracks error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn delete_playlist(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::delete_playlist(&conn, id).map_err(|e| {
        eprintln!("delete_playlist error: {e}");
        e.to_string()
    })?;
    Ok(())
}
