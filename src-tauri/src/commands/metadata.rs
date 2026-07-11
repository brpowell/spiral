use super::library::DbState;
use crate::art_cache::{self, guess_ext_from_url};
use crate::lyrics_normalize;
use crate::lyrics_sidecar;
use crate::metadata_reader;
use crate::models::TrackInput;
use crate::artist_art_fetch;
use crate::cover_art_fetch::{self, CoverArtCandidate};
use crate::disc_metadata_cache;
use crate::lyrics_fetch;
use crate::db;
use crate::library_organize;
use crate::metadata_backup;
use crate::metadata_writer;
use crate::activity_log::{self, LogLevel};
use crate::settings;
use crate::models::{Track, TrackMetadataUpdate};
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

const ART_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10);

#[tauri::command]
pub async fn parse_track_metadata(
    app: AppHandle,
    file_path: String,
) -> Result<TrackInput, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let app_data = app_data_dir(&app)?;
        let lyrics_sidecar_enabled = settings::lyrics_sidecar_sync_enabled(&app);
        metadata_reader::parse_track_metadata(&app_data, &file_path, lyrics_sidecar_enabled)
    })
    .await
    .map_err(|e| e.to_string())?
}

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
        .timeout(ART_DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|e| {
            activity_log::log(
                LogLevel::Error,
                "metadata.coverArt",
                "Failed to build HTTP client for cover art download",
                Some(serde_json::json!({ "error": e.to_string(), "url": url })),
            );
            e.to_string()
        })?;

    let response = client.get(&url).send().map_err(|e| {
        activity_log::log(
            LogLevel::Error,
            "metadata.coverArt",
            "Failed to download cover art",
            Some(serde_json::json!({ "error": e.to_string(), "url": url })),
        );
        format!("Failed to download cover art: {e}")
    })?;

    if !response.status().is_success() {
        activity_log::log(
            LogLevel::Error,
            "metadata.coverArt",
            format!("Cover art download failed with HTTP {}", response.status()),
            Some(serde_json::json!({
                "url": url,
                "httpStatus": response.status().as_u16(),
            })),
        );
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
    if let Some(existing) = art_cache::find_cached_art_path(&app_data, &file_path) {
        return Ok(existing.to_string_lossy().into_owned());
    }
    let dest = art_cache::write_bytes_to_art_cache(&app_data, &file_path, &bytes, ext)?;
    let dest_str = dest.to_string_lossy().into_owned();

    activity_log::log(
        LogLevel::Info,
        "metadata.coverArt",
        format!("Cached cover art to {dest_str}"),
        Some(serde_json::json!({
            "url": url,
            "cachePath": dest_str,
            "byteCount": bytes.len(),
        })),
    );

    Ok(dest_str)
}

#[tauri::command]
pub fn resolve_cached_art_path(app: AppHandle, file_path: String) -> Result<Option<String>, String> {
    let app_data = app_data_dir(&app)?;
    Ok(art_cache::find_cached_art_path(&app_data, &file_path)
        .map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn fetch_cover_art(
    artist: String,
    album: String,
    log_context: Option<activity_log::ActivityLogContext>,
) -> Result<Vec<CoverArtCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(ctx) = log_context {
            activity_log::set_thread_context(ctx);
        }
        let result = cover_art_fetch::fetch_cover_art_cached(artist, album);
        activity_log::clear_thread_context();
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fetch_cover_art_for_release(
    release_mbid: String,
    log_context: Option<activity_log::ActivityLogContext>,
) -> Result<Vec<CoverArtCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(ctx) = log_context {
            activity_log::set_thread_context(ctx);
        }
        let result = cover_art_fetch::fetch_cover_art_for_release_cached(release_mbid);
        activity_log::clear_thread_context();
        result
    })
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
pub async fn clear_metadata_cache(app: AppHandle) -> Result<(), String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        disc_metadata_cache::clear_lookup_cache(&app)?;
        lyrics_fetch::clear_fetch_cache(&app)?;
        cover_art_fetch::clear_fetch_cache();
        artist_art_fetch::clear_fetch_cache();

        activity_log::log(
            LogLevel::Info,
            "metadata.cache",
            "Cleared remote metadata fetch caches",
            None,
        );

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn write_track_metadata(
    app: AppHandle,
    state: State<DbState>,
    track_id: i64,
    file_path: String,
    mut metadata: TrackMetadataUpdate,
) -> Result<Track, String> {
    let path = Path::new(&file_path);
    let backup_config = settings::metadata_backup_config(&app);
    let library = settings::resolved_library_settings(&app);

    metadata_writer::write_track_metadata(path, &metadata, &backup_config)
        .map_err(|e| e.to_message())?;

    let mut final_path = file_path.clone();

    if library.auto_organize {
        if let Some(new_path) = library_organize::relocate_track_after_metadata(
            &library.media_folder,
            &library.organize_path_format,
            path,
            &metadata,
            library.lyrics_sidecar_sync_enabled,
        )? {
            final_path = new_path.to_string_lossy().into_owned();
            let app_data = app_data_dir(&app)?;
            if let Some(new_art) = library_organize::migrate_art_cache(
                &app_data,
                &file_path,
                &final_path,
                metadata.art_path.as_deref(),
            )? {
                metadata.art_path = Some(new_art);
            }
        }
    }

    if let Some(parent) = Path::new(&final_path).parent() {
        if let Err(e) = metadata_backup::cleanup_backups_in_dir(parent, &backup_config) {
            eprintln!("metadata backup cleanup after write: {e}");
        }
    }

    let new_file_path = if final_path != file_path {
        Some(final_path.as_str())
    } else {
        None
    };

    if metadata.lyrics_changed && library.lyrics_sidecar_sync_enabled {
        lyrics_sidecar::sync_sidecar(Path::new(&final_path), metadata.lyrics.as_ref())?;
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::update_track(&conn, track_id, &metadata, new_file_path, None).map_err(|e| {
        eprintln!("update_track error: {e}");
        e.to_string()
    })?;

    if metadata.lyrics_changed {
        if let Some(lyrics) = metadata.lyrics.as_ref().filter(|lyrics| {
            lyrics.format == crate::models::LyricsFormat::Instrumental
                || !lyrics.plain_text.trim().is_empty()
        }) {
            let record = lyrics_normalize::track_lyrics_input_to_record(lyrics.clone(), track_id);
            db::upsert_track_lyrics(&conn, &record).map_err(|e| {
                eprintln!("upsert_track_lyrics error: {e}");
                e.to_string()
            })?;
        } else {
            db::delete_track_lyrics(&conn, track_id).map_err(|e| {
                eprintln!("delete_track_lyrics error: {e}");
                e.to_string()
            })?;
        }
    }

    let track = db::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track {track_id} not found after update"))?;

    Ok(track)
}

#[tauri::command]
pub async fn ensure_art_row_thumb(
    app: AppHandle,
    art_path: String,
    size: Option<u32>,
) -> Result<Option<String>, String> {
    let size = size.unwrap_or(crate::art_thumb::ROW_THUMB_SIZE);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let app_data = app_data_dir(&app)?;
        crate::art_thumb::ensure_row_thumb(&app_data, &art_path, size)
            .map(|path| path.map(|p| p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}
