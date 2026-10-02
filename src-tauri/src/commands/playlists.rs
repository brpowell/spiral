use crate::artwork_paths::{self, resolve_library_relative};
use crate::db;
use crate::models::{Playlist, PlaylistImageMode};
use crate::settings;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

use super::library::DbState;

fn hydrate_playlist_image(library_root: &Path, playlist: &mut Playlist) {
    let Some(path) = playlist.custom_image_path.as_deref() else {
        return;
    };
    if Path::new(path).is_absolute() {
        return;
    }
    let abs = resolve_library_relative(library_root, path);
    if abs.is_file() {
        playlist.custom_image_path = Some(abs.to_string_lossy().into_owned());
    }
}

fn store_playlist_image(library_root: &Path, path: Option<&str>) -> Option<String> {
    let path = path?;
    let p = Path::new(path);
    if p.is_absolute() {
        artwork_paths::to_library_relative(library_root, p).or_else(|| Some(path.to_string()))
    } else {
        Some(path.to_string())
    }
}

#[tauri::command]
pub fn store_cropped_playlist_art(
    app: AppHandle,
    playlist_id: i64,
    title: String,
    source_path: String,
    crop: crate::image_crop::ImageCrop,
) -> Result<String, String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    crate::artwork_write::store_cropped_playlist_art(
        &library_root,
        playlist_id,
        &title,
        &source_path,
        crop,
    )
}

#[tauri::command]
pub fn get_playlists(app: AppHandle, state: State<DbState>) -> Result<Vec<Playlist>, String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut playlists = db::get_all_playlists(&conn).map_err(|e| {
        eprintln!("get_playlists error: {e}");
        e.to_string()
    })?;
    for playlist in &mut playlists {
        hydrate_playlist_image(&library_root, playlist);
    }
    Ok(playlists)
}

#[tauri::command]
pub fn create_playlist(
    app: AppHandle,
    state: State<DbState>,
    title: String,
    description: Option<String>,
    image_mode: PlaylistImageMode,
    custom_image_path: Option<String>,
    cover_background: Option<String>,
    cover_background_end: Option<String>,
    cover_icon: Option<String>,
) -> Result<i64, String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    let stored = store_playlist_image(&library_root, custom_image_path.as_deref());
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::create_playlist(
        &conn,
        &title,
        description.as_deref(),
        image_mode,
        stored.as_deref(),
        cover_background.as_deref(),
        cover_background_end.as_deref(),
        cover_icon.as_deref(),
    )
    .map_err(|e| {
        eprintln!("create_playlist error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn update_playlist(
    app: AppHandle,
    state: State<DbState>,
    id: i64,
    title: String,
    description: Option<String>,
    image_mode: PlaylistImageMode,
    custom_image_path: Option<String>,
    cover_background: Option<String>,
    cover_background_end: Option<String>,
    cover_icon: Option<String>,
) -> Result<(), String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let (old_title, old_image): (String, Option<String>) = conn
        .query_row(
            "SELECT title, custom_image_path FROM playlists WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let mut stored = if image_mode == PlaylistImageMode::Custom {
        store_playlist_image(&library_root, custom_image_path.as_deref())
    } else {
        None
    };
    if image_mode == PlaylistImageMode::Custom && old_title.trim() != title.trim() {
        stored = crate::artwork_organize::rename_playlist_artwork_file(
            &library_root,
            id,
            &old_title,
            &title,
            stored.as_deref().or(old_image.as_deref()),
        )?;
    }
    if stored.is_none() {
        crate::artwork_organize::remove_playlist_artwork(&library_root, id)?;
    }

    db::update_playlist(
        &conn,
        id,
        &title,
        description.as_deref(),
        image_mode,
        stored.as_deref(),
        cover_background.as_deref(),
        cover_background_end.as_deref(),
        cover_icon.as_deref(),
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
pub fn reorder_playlists(state: State<DbState>, playlist_ids: Vec<i64>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::reorder_playlists(&conn, &playlist_ids).map_err(|e| {
        eprintln!("reorder_playlists error: {e}");
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
