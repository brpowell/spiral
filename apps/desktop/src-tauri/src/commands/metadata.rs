use super::library::DbState;
use crate::activity_log::{self, LogLevel};
use crate::art_cache::{self, guess_ext_from_url};
use crate::artist_art_fetch;
use crate::cover_art_fetch::{self, CoverArtCandidate};
use crate::db;
use crate::disc_metadata_cache;
use crate::library_organize;
use crate::lyrics_fetch;
use crate::lyrics_normalize;
use crate::lyrics_sidecar;
use crate::metadata_reader;
use crate::metadata_writer;
use crate::models::TrackInput;
use crate::models::{Track, TrackMetadataUpdate};
use crate::path_scope;
use crate::settings;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

const ART_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10);

#[tauri::command]
pub async fn parse_track_metadata(app: AppHandle, file_path: String) -> Result<TrackInput, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let app_data = app_data_dir(&app)?;
        let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
        let lyrics_sidecar_enabled = settings::lyrics_sidecar_sync_enabled(&app);
        metadata_reader::parse_track_metadata_for_library(
            &app_data,
            &file_path,
            lyrics_sidecar_enabled,
            Some(&library_root),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn pick_image_file(app: AppHandle) -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .set_title("Select album art")
        .add_filter(
            "Images",
            &["jpg", "jpeg", "png", "webp", "JPG", "JPEG", "PNG", "WEBP"],
        )
        .pick_file();
    if let Some(path) = &path {
        path_scope::allow_file(&app, path);
    }

    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn cache_art_from_file(
    app: AppHandle,
    source_path: String,
    file_path: String,
    crop: Option<crate::image_crop::ImageCrop>,
    max_edge: Option<u32>,
) -> Result<String, String> {
    path_scope::ensure_allowed(&app, &source_path)?;
    // Decoding and baking a crop is slow; keep it off the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        let bytes =
            std::fs::read(&source_path).map_err(|e| format!("Failed to read image: {e}"))?;
        let max_edge = crate::image_crop::clamp_max_edge(max_edge);
        // An unedited pick keeps the original file instead of being re-encoded.
        let crop = match crop {
            Some(crop) if crate::image_crop::is_passthrough(&bytes, crop, max_edge)? => None,
            other => other,
        };
        let (bytes, ext) = match crop {
            Some(crop) => {
                let (baked, ext) = crate::image_crop::bake_cropped_image(&bytes, crop, max_edge)?;
                (baked, ext)
            }
            None => (
                bytes,
                Path::new(&source_path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("jpg"),
            ),
        };
        let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
        let app_data = app_data_dir(&app)?;
        crate::artwork_write::write_art_for_cache_key(
            &library_root,
            &app_data,
            &file_path,
            &bytes,
            ext,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Encoded sizes (bytes) of the cropped result at each output cap, plus the
/// source file's own size, so the editor can show what a size choice will save.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasuredArtSizes {
    source_bytes: u64,
    output_bytes: Vec<u64>,
}

/// The last source measured, kept decoded so dragging or zooming only has to
/// crop and encode. Dropped when the editor closes.
type MeasureCacheEntry = (
    PathBuf,
    std::time::SystemTime,
    u64,
    Arc<crate::image_crop::DecodedSource>,
);

static MEASURE_CACHE: Mutex<Option<MeasureCacheEntry>> = Mutex::new(None);

fn decoded_source_for_measure(
    path: &Path,
) -> Result<(Arc<crate::image_crop::DecodedSource>, u64), String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Failed to read image: {e}"))?;
    let modified = meta.modified().map_err(|e| e.to_string())?;
    let len = meta.len();
    if let Some((cached_path, cached_modified, cached_len, source)) =
        MEASURE_CACHE.lock().map_err(|e| e.to_string())?.as_ref()
    {
        if cached_path == path && *cached_modified == modified && *cached_len == len {
            return Ok((Arc::clone(source), len));
        }
    }
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read image: {e}"))?;
    let source = Arc::new(crate::image_crop::decode_source(&bytes)?);
    *MEASURE_CACHE.lock().map_err(|e| e.to_string())? =
        Some((path.to_path_buf(), modified, len, Arc::clone(&source)));
    Ok((source, len))
}

#[tauri::command]
pub async fn measure_art_sizes(
    app: AppHandle,
    source_path: String,
    crop: crate::image_crop::ImageCrop,
    max_edges: Vec<Option<u32>>,
) -> Result<MeasuredArtSizes, String> {
    path_scope::ensure_allowed(&app, &source_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (source, source_bytes) = decoded_source_for_measure(Path::new(&source_path))?;
        let output_bytes = crate::image_crop::measure_decoded_sizes(&source, crop, &max_edges)?;
        Ok(MeasuredArtSizes {
            source_bytes,
            output_bytes,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Frees the decoded source kept for [`measure_art_sizes`].
#[tauri::command]
pub fn clear_art_measure_cache() {
    if let Ok(mut cache) = MEASURE_CACHE.lock() {
        *cache = None;
    }
}

#[tauri::command]
pub fn cache_art_from_bytes(
    app: AppHandle,
    bytes: Vec<u8>,
    file_path: String,
    format: String,
) -> Result<String, String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    let app_data = app_data_dir(&app)?;
    crate::artwork_write::write_art_for_cache_key(
        &library_root,
        &app_data,
        &file_path,
        &bytes,
        &format,
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedArtFromUrl {
    path: String,
    byte_count: u64,
}

#[tauri::command]
pub async fn cache_art_from_url(
    app: AppHandle,
    url: String,
    file_path: String,
    log_context: Option<activity_log::ActivityLogContext>,
) -> Result<CachedArtFromUrl, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(ctx) = log_context {
            activity_log::set_thread_context(ctx);
        }
        let result = cache_art_from_url_blocking(app, url, file_path);
        activity_log::clear_thread_context();
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

fn cache_art_from_url_blocking(
    app: AppHandle,
    url: String,
    file_path: String,
) -> Result<CachedArtFromUrl, String> {
    let domain = "metadata";
    let is_artist_art = file_path.starts_with("artist:");
    let kind = if is_artist_art {
        "artist art"
    } else {
        "cover art"
    };
    let client = reqwest::blocking::Client::builder()
        .user_agent(crate::USER_AGENT)
        .timeout(ART_DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|e| {
            activity_log::log(
                LogLevel::Error,
                domain,
                format!("Failed to build HTTP client for {kind} download"),
                Some(serde_json::json!({ "error": e.to_string(), "url": url })),
            );
            e.to_string()
        })?;

    let response = client.get(&url).send().map_err(|e| {
        activity_log::log(
            LogLevel::Error,
            domain,
            format!("Failed to download {kind}"),
            Some(serde_json::json!({ "error": e.to_string(), "url": url })),
        );
        format!("Failed to download {kind}: {e}")
    })?;

    if !response.status().is_success() {
        activity_log::log(
            LogLevel::Error,
            domain,
            format!(
                "{} download failed with HTTP {}",
                match kind {
                    "artist art" => "Artist art",
                    _ => "Cover art",
                },
                response.status()
            ),
            Some(serde_json::json!({
                "url": url,
                "httpStatus": response.status().as_u16(),
            })),
        );
        return Err(format!(
            "Failed to download {kind} (HTTP {})",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .map_err(|e| format!("Failed to read {kind}: {e}"))?;

    let ext = guess_ext_from_url(&url);
    let app_data = app_data_dir(&app)?;
    let byte_count = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);

    let dest_str = crate::artwork_write::write_art_for_cache_key(
        &library_root,
        &app_data,
        &file_path,
        &bytes,
        ext,
    )?;

    // CD auto-fetch logs its own completion line from the frontend.
    if !activity_log::thread_has_drive_id() {
        let cached_label = if is_artist_art {
            let artist = activity_log::thread_artist()
                .or_else(|| {
                    file_path
                        .strip_prefix("artist:")
                        .map(|name| name.to_string())
                })
                .unwrap_or_else(|| "artist".to_string());
            format!("Saved artist art for \"{artist}\"")
        } else {
            format!("Cached cover art to {dest_str}")
        };
        activity_log::log(
            LogLevel::Info,
            domain,
            cached_label,
            Some(serde_json::json!({
                "url": url,
                "cachePath": dest_str,
                "byteCount": byte_count,
            })),
        );
    }

    Ok(CachedArtFromUrl {
        path: dest_str,
        byte_count,
    })
}

#[tauri::command]
pub fn resolve_cached_art_path(
    app: AppHandle,
    file_path: String,
) -> Result<Option<String>, String> {
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
pub async fn fetch_artist_art(
    artist: String,
    artist_mbid: Option<String>,
    log_context: Option<activity_log::ActivityLogContext>,
) -> Result<Vec<CoverArtCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(ctx) = log_context {
            activity_log::set_thread_context(ctx);
        }
        let result = artist_art_fetch::fetch_artist_art_cached(artist, artist_mbid);
        activity_log::clear_thread_context();
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn search_musicbrainz_entities(
    kind: crate::musicbrainz_entity::MusicBrainzEntityKind,
    query: String,
    artist: Option<String>,
) -> Result<Vec<crate::musicbrainz_entity::MusicBrainzEntityHit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::musicbrainz_entity::search_entities(kind, query, artist)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_musicbrainz_entity(
    state: State<DbState>,
    kind: crate::musicbrainz_entity::MusicBrainzEntityKind,
    mbid: String,
) -> Result<Option<crate::musicbrainz_entity::MusicBrainzEntityLookup>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    crate::musicbrainz_entity::get_entity(&conn, kind, mbid)
}

#[tauri::command]
pub async fn fetch_musicbrainz_entity(
    app: AppHandle,
    kind: crate::musicbrainz_entity::MusicBrainzEntityKind,
    mbid: String,
) -> Result<Option<crate::musicbrainz_entity::MusicBrainzEntityLookup>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::musicbrainz_entity::fetch_entity_with_store(kind, mbid, |response| {
            let state = app.state::<DbState>();
            let conn = state.0.lock().map_err(|e| e.to_string())?;
            let entity_mbid = response
                .get("id")
                .and_then(|id| id.as_str())
                .and_then(|id| crate::mbid::parse_uuid_mbid(Some(id)))
                .ok_or_else(|| "MusicBrainz response missing entity id".to_string())?;
            crate::musicbrainz_entity::store_entity_document(&conn, kind, &entity_mbid, response)
        })
    })
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
            "metadata",
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
    let library = settings::resolved_library_settings(&app);
    let library_root = PathBuf::from(&library.library_root);

    let existing = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        db::get_track_by_id(&conn, track_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track {track_id} not found"))?
    };

    metadata_writer::write_track_metadata(path, &metadata).map_err(|e| e.to_message())?;

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
                metadata
                    .art_path
                    .as_deref()
                    .or(existing.art_path.as_deref()),
            )? {
                metadata.art_path = Some(new_art);
            }
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

    let old_identity = (
        crate::artwork_paths::album_artist_for_path(
            existing.album_artist.as_deref(),
            existing.artist.as_deref(),
        ),
        crate::artwork_paths::album_title_for_path(existing.album.as_deref()),
    );
    let new_identity = (
        crate::artwork_paths::album_artist_for_path(
            metadata.album_artist.as_deref(),
            metadata.artist.as_deref(),
        ),
        crate::artwork_paths::album_title_for_path(metadata.album.as_deref()),
    );
    let identity_changed = old_identity != new_identity;

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;

        if identity_changed {
            let art_for_reconcile = if metadata.art_changed {
                metadata.art_path.as_deref()
            } else {
                existing.art_path.as_deref()
            };
            metadata.art_path = crate::artwork_organize::reconcile_track_album_artwork(
                &conn,
                &library_root,
                track_id,
                existing.album_artist.as_deref(),
                existing.artist.as_deref(),
                existing.album.as_deref(),
                metadata.album_artist.as_deref(),
                metadata.artist.as_deref(),
                metadata.album.as_deref(),
                art_for_reconcile,
            )?;
            if metadata.art_changed {
                metadata.art_path = crate::artwork_write::track_art_path_for_db(
                    &library_root,
                    metadata.art_path.as_deref(),
                );
            }
        } else if metadata.art_changed {
            metadata.art_path = crate::artwork_write::track_art_path_for_db(
                &library_root,
                metadata.art_path.as_deref(),
            );
        } else {
            // Keep stored library-relative pointer; ignore hydrated absolute from UI.
            metadata.art_path = existing.art_path.clone();
        }

        db::update_track(&conn, track_id, &metadata, new_file_path, None).map_err(|e| {
            eprintln!("update_track error: {e}");
            e.to_string()
        })?;

        // Overwrite / clear-to-canonical: drop override files nothing else still points at.
        if metadata.art_changed {
            let previous = existing.art_path.as_deref();
            let next = metadata.art_path.as_deref();
            let previous_key = previous.map(|p| p.replace('\\', "/"));
            let next_key = next.map(|p| p.replace('\\', "/"));
            if previous_key != next_key {
                if let Err(err) = crate::artwork_organize::gc_unreferenced_override_file(
                    &conn,
                    &library_root,
                    previous,
                ) {
                    eprintln!("artwork GC after metadata write: {err}");
                }
            }
        }

        if metadata.lyrics_changed {
            if let Some(lyrics) = metadata.lyrics.as_ref().filter(|lyrics| {
                lyrics.format == crate::models::LyricsFormat::Instrumental
                    || !lyrics.plain_text.trim().is_empty()
            }) {
                let record =
                    lyrics_normalize::track_lyrics_input_to_record(lyrics.clone(), track_id);
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

        let mut track = db::get_track_by_id(&conn, track_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track {track_id} not found after metadata write"))?;
        crate::artwork_paths::hydrate_track_art_path(&library_root, &mut track);
        Ok(track)
    }
}

#[tauri::command]
pub fn rename_album_artwork(
    app: AppHandle,
    state: State<DbState>,
    old_album_artist: Option<String>,
    old_artist: Option<String>,
    old_album: Option<String>,
    new_album_artist: Option<String>,
    new_artist: Option<String>,
    new_album: Option<String>,
) -> Result<(), String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    crate::artwork_organize::rename_album_artwork_dir(
        &conn,
        &library_root,
        old_album_artist.as_deref(),
        old_artist.as_deref(),
        old_album.as_deref(),
        new_album_artist.as_deref(),
        new_artist.as_deref(),
        new_album.as_deref(),
    )
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
        if !path_scope::is_allowed(&app, Path::new(&art_path)) {
            return Ok(None);
        }
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
