use super::library::DbState;
use crate::art_cache::{self, guess_ext_from_url};
use crate::artist_art_fetch;
use crate::cover_art_fetch::{self, CoverArtCandidate};
use crate::db;
use crate::metadata_backup;
use crate::metadata_writer;
use crate::settings;
use crate::models::{Track, TrackMetadataUpdate};
use std::path::Path;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn pick_image_file() -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .set_title("Select album art")
        .add_filter(
            "Images",
            &["jpg", "jpeg", "png", "webp", "JPG", "JPEG", "PNG", "WEBP"],
        )
        .pick_file();

    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn cache_art_from_file(
    app: AppHandle,
    source_path: String,
    file_path: String,
) -> Result<String, String> {
    let app_data = app_data_dir(&app)?;
    let dest = art_cache::copy_to_art_cache(&app_data, &file_path, Path::new(&source_path))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn cache_art_from_bytes(
    app: AppHandle,
    bytes: Vec<u8>,
    file_path: String,
    format: String,
) -> Result<String, String> {
    let ext = art_cache::ext_from_mime(&format);
    let app_data = app_data_dir(&app)?;
    let dest = art_cache::write_bytes_to_art_cache(&app_data, &file_path, &bytes, ext)?;
    Ok(dest.to_string_lossy().into_owned())
}

const MUSICBRAINZ_USER_AGENT: &str = "Spiral/0.1.0 (https://github.com/brpowell/spiral)";

#[tauri::command]
pub async fn cache_art_from_url(
    app: AppHandle,
    url: String,
    file_path: String,
) -> Result<String, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || cache_art_from_url_blocking(app, url, file_path))
        .await
        .map_err(|e| e.to_string())?
}

fn cache_art_from_url_blocking(
    app: AppHandle,
    url: String,
    file_path: String,
) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(MUSICBRAINZ_USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .map_err(|e| format!("Failed to download cover art: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download cover art (HTTP {})",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .map_err(|e| format!("Failed to read cover art: {e}"))?;

    let ext = guess_ext_from_url(&url);
    let app_data = app_data_dir(&app)?;
    let dest = art_cache::write_bytes_to_art_cache(&app_data, &file_path, &bytes, ext)?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn fetch_cover_art(
    artist: String,
    album: String,
) -> Result<Vec<CoverArtCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || cover_art_fetch::fetch_cover_art_cached(artist, album))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fetch_artist_art(artist: String) -> Result<Vec<CoverArtCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || artist_art_fetch::fetch_artist_art_cached(artist))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn write_track_metadata(
    app: AppHandle,
    state: State<DbState>,
    track_id: i64,
    file_path: String,
    metadata: TrackMetadataUpdate,
) -> Result<Track, String> {
    let path = Path::new(&file_path);
    let backup_config = settings::metadata_backup_config(&app);

    metadata_writer::write_track_metadata(path, &metadata, &backup_config)
        .map_err(|e| e.to_message())?;

    if let Some(parent) = path.parent() {
        if let Err(e) = metadata_backup::cleanup_backups_in_dir(parent, &backup_config) {
            eprintln!("metadata backup cleanup after write: {e}");
        }
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::update_track(&conn, track_id, &metadata).map_err(|e| {
        eprintln!("update_track error: {e}");
        e.to_string()
    })?;

    let track = db::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track {track_id} not found after update"))?;

    let _ = app;
    Ok(track)
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

