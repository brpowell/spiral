use crate::db;
use crate::ids::{PlaylistId, TrackId};
use crate::models::{Playlist, PlaylistImageMode};
use crate::settings;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

use super::library::DbState;

/// Fill `custom_image_path` with the file to show for the playlist's cover.
fn hydrate_playlist_image(
    conn: &rusqlite::Connection,
    library_root: &Path,
    playlist: &mut Playlist,
) {
    playlist.custom_image_path =
        crate::artwork_write::playlist_cover_path(conn, library_root, &playlist.id)
            .ok()
            .flatten()
            .map(|p| p.to_string_lossy().into_owned());
}

#[tauri::command]
pub fn store_cropped_playlist_art(
    app: AppHandle,
    playlist_id: PlaylistId,
    title: String,
    source_path: String,
    crop: crate::image_crop::ImageCrop,
) -> Result<String, String> {
    let source_path = crate::path_scope::ensure_allowed(&app, &source_path)?
        .to_string_lossy()
        .into_owned();
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    crate::artwork_write::store_cropped_playlist_art(
        &library_root,
        &playlist_id,
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
        hydrate_playlist_image(&conn, &library_root, playlist);
    }
    Ok(playlists)
}

/// Record a playlist's cover: the picked image in custom mode, none otherwise.
fn save_playlist_cover(
    conn: &rusqlite::Connection,
    library_root: &Path,
    id: &PlaylistId,
    title: &str,
    image_mode: PlaylistImageMode,
    custom_image_path: Option<&str>,
) -> Result<(), String> {
    let picked = custom_image_path
        .filter(|_| image_mode == PlaylistImageMode::Custom)
        .map(Path::new);
    crate::artwork_write::set_playlist_cover(conn, library_root, id, title, picked)
}

#[allow(clippy::too_many_arguments)]
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
) -> Result<PlaylistId, String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = db::create_playlist(
        &conn,
        &title,
        description.as_deref(),
        image_mode,
        cover_background.as_deref(),
        cover_background_end.as_deref(),
        cover_icon.as_deref(),
    )
    .map_err(|e| {
        eprintln!("create_playlist error: {e}");
        e.to_string()
    })?;
    if custom_image_path.is_some() {
        save_playlist_cover(
            &conn,
            &library_root,
            &id,
            &title,
            image_mode,
            custom_image_path.as_deref(),
        )?;
    }
    Ok(id)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn update_playlist(
    app: AppHandle,
    state: State<DbState>,
    id: PlaylistId,
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

    db::update_playlist(
        &conn,
        &id,
        &title,
        description.as_deref(),
        image_mode,
        cover_background.as_deref(),
        cover_background_end.as_deref(),
        cover_icon.as_deref(),
    )
    .map_err(|e| {
        eprintln!("update_playlist error: {e}");
        e.to_string()
    })?;
    // A renamed playlist's cover file is renamed with it.
    save_playlist_cover(
        &conn,
        &library_root,
        &id,
        &title,
        image_mode,
        custom_image_path.as_deref(),
    )
}

#[tauri::command]
pub fn touch_playlist(state: State<DbState>, id: PlaylistId) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::touch_playlist(&conn, &id).map_err(|e| {
        eprintln!("touch_playlist error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn add_tracks_to_playlist(
    state: State<DbState>,
    playlist_id: PlaylistId,
    track_ids: Vec<TrackId>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::add_tracks_to_playlist(&conn, &playlist_id, &track_ids).map_err(|e| {
        eprintln!("add_tracks_to_playlist error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn remove_tracks_from_playlist(
    state: State<DbState>,
    playlist_id: PlaylistId,
    track_ids: Vec<TrackId>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::remove_tracks_from_playlist(&conn, &playlist_id, &track_ids).map_err(|e| {
        eprintln!("remove_tracks_from_playlist error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn reorder_playlist_tracks(
    state: State<DbState>,
    playlist_id: PlaylistId,
    track_ids: Vec<TrackId>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::reorder_playlist_tracks(&conn, &playlist_id, &track_ids).map_err(|e| {
        eprintln!("reorder_playlist_tracks error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn reorder_playlists(
    state: State<DbState>,
    playlist_ids: Vec<PlaylistId>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::reorder_playlists(&conn, &playlist_ids).map_err(|e| {
        eprintln!("reorder_playlists error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn delete_playlist(
    app: AppHandle,
    state: State<DbState>,
    id: PlaylistId,
) -> Result<(), String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::delete_playlist(&conn, &id).map_err(|e| {
        eprintln!("delete_playlist error: {e}");
        e.to_string()
    })?;
    // Its cover link went with it; the cover file goes too.
    crate::artwork_registry::prune(&conn, &library_root)?;
    Ok(())
}
