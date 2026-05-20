use crate::art_cache;
use crate::db;
use crate::models::{Track, TrackInput};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct DbState(pub Mutex<rusqlite::Connection>);

#[tauri::command]
pub fn save_track(state: State<DbState>, track: TrackInput) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::save_track(&conn, &track).map_err(|e| {
        eprintln!("save_track error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn get_library(state: State<DbState>) -> Result<Vec<Track>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_all_tracks(&conn).map_err(|e| {
        eprintln!("get_library error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn record_track_play(state: State<DbState>, track_id: i64) -> Result<u32, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::increment_play_count(&conn, track_id).map_err(|e| {
        eprintln!("record_track_play error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn remove_track(
    app: AppHandle,
    state: State<DbState>,
    track_id: i64,
    delete_from_disk: bool,
) -> Result<(), String> {
    let track = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let track = db::get_track_by_id(&conn, track_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track {track_id} not found"))?;
        db::delete_track(&conn, track_id).map_err(|e| e.to_string())?;
        track
    };

    if delete_from_disk {
        let audio_path = Path::new(&track.file_path);
        if audio_path.exists() {
            fs::remove_file(audio_path).map_err(|e| format!("Failed to delete audio file: {e}"))?;
        }
    }

    if let Some(art_path) = &track.art_path {
        let path = Path::new(art_path);
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }

    if let Ok(app_data) = app.path().app_data_dir() {
        let _ = art_cache::remove_cached_art(&app_data, &track.file_path);
    }

    Ok(())
}
