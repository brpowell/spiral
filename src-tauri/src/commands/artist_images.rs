use super::library::DbState;
use crate::artwork_paths::{self, resolve_library_relative};
use crate::db;
use crate::models::ArtistImage;
use crate::settings;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_artist_images(
    app: AppHandle,
    state: State<DbState>,
) -> Result<Vec<ArtistImage>, String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut images = db::get_all_artist_images(&conn).map_err(|e| e.to_string())?;
    for image in &mut images {
        if Path::new(&image.art_path).is_absolute() {
            continue;
        }
        let abs = resolve_library_relative(&library_root, &image.art_path);
        if abs.is_file() {
            image.art_path = abs.to_string_lossy().into_owned();
        }
    }
    Ok(images)
}

#[tauri::command]
pub fn save_artist_image(
    app: AppHandle,
    state: State<DbState>,
    artist_key: String,
    art_path: Option<String>,
) -> Result<(), String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    let stored = art_path.as_deref().and_then(|p| {
        let path = Path::new(p);
        if path.is_absolute() {
            artwork_paths::to_library_relative(&library_root, path).or_else(|| Some(p.to_string()))
        } else {
            Some(p.to_string())
        }
    });
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::save_artist_image(&conn, &artist_key, stored.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_artist_image_key(
    app: AppHandle,
    state: State<DbState>,
    old_key: String,
    new_key: String,
) -> Result<(), String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    let new_rel =
        crate::artwork_organize::rename_artist_artwork_dir(&library_root, &old_key, &new_key)?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::rename_artist_image_key(&conn, &old_key, &new_key).map_err(|e| e.to_string())?;
    if let Some(rel) = new_rel {
        db::save_artist_image(&conn, &new_key, Some(&rel)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
