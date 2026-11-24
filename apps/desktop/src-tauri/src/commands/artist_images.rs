use super::library::DbState;
use crate::artwork_registry::{self, ArtworkKind};
use crate::models::ArtistImage;
use crate::settings;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

/// Every artist portrait with a file to show. One whose every copy is damaged
/// is left out, so the artist shows the placeholder.
#[tauri::command]
pub fn get_artist_images(
    app: AppHandle,
    state: State<DbState>,
) -> Result<Vec<ArtistImage>, String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut images = Vec::new();
    for (artist_key, hash) in artwork_registry::all_artist_art(&conn, ArtworkKind::Portrait)? {
        if let Some(path) =
            crate::artwork_write::artist_portrait_path(&conn, &library_root, &artist_key, &hash)?
        {
            images.push(ArtistImage {
                artist_key,
                art_path: path.to_string_lossy().into_owned(),
            });
        }
    }
    Ok(images)
}

/// Record the portrait the artist editor picked (`None` removes it).
#[tauri::command]
pub fn save_artist_image(
    app: AppHandle,
    state: State<DbState>,
    artist_key: String,
    art_path: Option<String>,
) -> Result<(), String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    crate::artwork_write::set_artist_portrait(
        &conn,
        &library_root,
        &artist_key,
        art_path.as_deref().filter(|p| !p.is_empty()).map(Path::new),
    )?;
    Ok(())
}

#[tauri::command]
pub fn rename_artist_image_key(
    app: AppHandle,
    state: State<DbState>,
    old_key: String,
    new_key: String,
) -> Result<Option<String>, String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let shown = crate::artwork_organize::rename_artist_artwork_dir(
        &conn,
        &library_root,
        &old_key,
        &new_key,
    )?;
    Ok(shown.map(|p| p.to_string_lossy().into_owned()))
}
