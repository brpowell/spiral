use crate::art_cache;
use crate::db;
use crate::import_files;
use crate::library_organize;
use crate::models::{Track, TrackInput, TrackMetadataUpdate};
use crate::settings;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct DbState(pub Mutex<rusqlite::Connection>);

fn track_input_to_metadata(input: &TrackInput) -> TrackMetadataUpdate {
    TrackMetadataUpdate {
        title: input.title.clone(),
        artist: input.artist.clone(),
        album: input.album.clone(),
        album_artist: input.album_artist.clone(),
        track_number: input.track_number,
        disc_number: input.disc_number,
        year: input.year,
        genre: input.genre.clone(),
        art_path: input.art_path.clone(),
        art_changed: false,
    }
}

fn path_is_under_media(media_folder: &Path, file_path: &Path) -> bool {
    let media = match media_folder.canonicalize() {
        Ok(path) => path,
        Err(_) => media_folder.to_path_buf(),
    };
    let file = match file_path.canonicalize() {
        Ok(path) => path,
        Err(_) => file_path.to_path_buf(),
    };
    file.starts_with(&media)
}

#[tauri::command]
pub fn save_track(state: State<DbState>, track: TrackInput) -> Result<Track, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = db::save_track(&conn, &track).map_err(|e| {
        eprintln!("save_track error: {e}");
        e.to_string()
    })?;
    db::get_track_by_id(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track {id} not found after save"))
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

    if let Ok(app_data) = app.path().app_data_dir() {
        let _ = art_cache::remove_cached_art(&app_data, &track.file_path);

        if let Some(art_path) = &track.art_path {
            if art_cache::art_path_is_track_owned(&app_data, &track.file_path, art_path) {
                let path = Path::new(art_path);
                if path.exists() {
                    let _ = fs::remove_file(path);
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn replace_track_from_import(
    app: AppHandle,
    state: State<DbState>,
    track_id: i64,
    source_path: String,
    mode: String,
    track: TrackInput,
) -> Result<Track, String> {
    let resolved = settings::resolved_library_settings(&app);
    let new_path = import_files::prepare_import_file(
        &source_path,
        &mode,
        resolved.auto_organize,
        &resolved.media_folder,
        &resolved.organize_path_format,
    )?;

    let (existing, mut metadata) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let existing = db::get_track_by_id(&conn, track_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track {track_id} not found"))?;
        let metadata = track_input_to_metadata(&track);
        (existing, metadata)
    };

    let old_path = PathBuf::from(&existing.file_path);
    let new_path_buf = PathBuf::from(&new_path);

    if let Ok(app_data) = app.path().app_data_dir() {
        if let Some(new_art) = library_organize::migrate_art_cache(
            &app_data,
            &existing.file_path,
            &new_path,
            metadata.art_path.as_deref(),
        )? {
            metadata.art_path = Some(new_art);
        }
    }

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        db::update_track(&conn, track_id, &metadata, Some(new_path.as_str())).map_err(|e| {
            eprintln!("replace_track_from_import update error: {e}");
            e.to_string()
        })?;
    }

    if old_path != new_path_buf {
        let media_folder = Path::new(&resolved.media_folder);
        if path_is_under_media(media_folder, &old_path) && old_path.is_file() {
            if let Err(e) = fs::remove_file(&old_path) {
                eprintln!("replace_track_from_import failed to delete old file: {e}");
            }
        }
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track {track_id} not found after replace"))
}
