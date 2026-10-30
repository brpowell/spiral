use crate::art_cache;
use crate::audio_properties;
use crate::db;
use crate::encoding_profiles;
use crate::import_files;
use crate::library_organize::{self, OrganizeMetadata};
use crate::lyrics_normalize;
use crate::lyrics_sidecar;
use crate::metadata_reader;
use crate::metadata_writer;
use crate::models::{
    ClearListenHistoryResult, ListenEventInput, RecordListenEventResult,
    RefreshLibraryMetadataResult, Track, TrackInput, TrackLyricsInput, TrackMetadataUpdate,
};
use crate::rating_sync::{schedule_rating_file_write, RatingSync};
use crate::settings;
use crate::sources::{self, LibraryRoots};
use crate::track_permissions::{track_permissions, TrackPermissions};
use crate::transcoder;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct DbState(pub Mutex<rusqlite::Connection>);

fn library_root(app: &AppHandle) -> PathBuf {
    PathBuf::from(settings::resolved_library_settings(app).library_root)
}

/// Load a track row and resolve `art_path` to an absolute display path for the UI.
pub(crate) fn track_for_ui(
    conn: &rusqlite::Connection,
    library_root: &Path,
    track_id: i64,
) -> Result<Track, String> {
    let mut track = db::get_track_by_id(conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track {track_id} not found"))?;
    crate::artwork_paths::hydrate_track_art_path(library_root, &mut track);
    Ok(track)
}

fn track_input_to_metadata(input: &TrackInput) -> TrackMetadataUpdate {
    TrackMetadataUpdate {
        title: input.title.clone(),
        artist: input.artist.clone(),
        album: input.album.clone(),
        album_artist: input.album_artist.clone(),
        track_number: input.track_number,
        total_tracks: input.total_tracks,
        disc_number: input.disc_number,
        total_discs: input.total_discs,
        year: input.year,
        genre: input.genre.clone(),
        art_path: input.art_path.clone(),
        art_changed: false,
        lyrics: None,
        lyrics_changed: false,
        recording_mbid: input.recording_mbid.clone(),
        release_mbid: input.release_mbid.clone(),
        artist_mbids: input.artist_mbids.clone(),
        album_artist_mbids: input.album_artist_mbids.clone(),
    }
}

fn track_to_metadata(track: &Track) -> TrackMetadataUpdate {
    TrackMetadataUpdate {
        title: track.title.clone(),
        artist: track.artist.clone(),
        album: track.album.clone(),
        album_artist: track.album_artist.clone(),
        track_number: track.track_number,
        total_tracks: track.total_tracks,
        disc_number: track.disc_number,
        total_discs: track.total_discs,
        year: track.year,
        genre: track.genre.clone(),
        art_path: track.art_path.clone(),
        art_changed: false,
        lyrics: None,
        lyrics_changed: false,
        recording_mbid: track.recording_mbid.clone(),
        release_mbid: track.release_mbid.clone(),
        artist_mbids: track.artist_mbids.clone(),
        album_artist_mbids: track.album_artist_mbids.clone(),
    }
}

fn track_to_input(track: &Track, file_path: String) -> TrackInput {
    let audio = audio_properties::read_audio_properties(Path::new(&file_path));
    TrackInput {
        title: track.title.clone(),
        artist: track.artist.clone(),
        album: track.album.clone(),
        album_artist: track.album_artist.clone(),
        track_number: track.track_number,
        total_tracks: track.total_tracks,
        disc_number: track.disc_number,
        total_discs: track.total_discs,
        year: track.year,
        genre: track.genre.clone(),
        duration_seconds: track.duration_seconds,
        sample_rate: audio.sample_rate,
        bitrate: audio.bitrate,
        codec: audio.codec,
        file_path,
        art_path: track.art_path.clone(),
        rating: Some(track.rating),
        lyrics: None,
        recording_mbid: track.recording_mbid.clone(),
        release_mbid: track.release_mbid.clone(),
        artist_mbids: track.artist_mbids.clone(),
        album_artist_mbids: track.album_artist_mbids.clone(),
    }
}

/// Resolve cover art on disk for embedding into a converted file.
fn resolve_convert_art_path(
    app: &AppHandle,
    track: &Track,
    source: &Path,
) -> Result<Option<String>, String> {
    if let Some(art_path) = &track.art_path {
        if Path::new(art_path).is_file() {
            return Ok(Some(art_path.clone()));
        }
    }

    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;

    if let Some(cached) = art_cache::find_cached_art_path(&app_data, &track.file_path) {
        return Ok(Some(cached.to_string_lossy().into_owned()));
    }

    let source_path = source.to_string_lossy();
    match metadata_reader::parse_track_metadata(
        &app_data,
        source_path.as_ref(),
        settings::lyrics_sidecar_sync_enabled(app),
    ) {
        Ok(input) => Ok(input.art_path),
        Err(_) => Ok(None),
    }
}

fn metadata_for_convert(
    app: &AppHandle,
    track: &Track,
    source: &Path,
) -> Result<TrackMetadataUpdate, String> {
    let mut metadata = track_to_metadata(track);
    if let Some(art_path) = resolve_convert_art_path(app, track, source)? {
        metadata.art_path = Some(art_path);
        metadata.art_changed = true;
    }
    Ok(metadata)
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

/// Fill codec / sample rate / bitrate from the file when the client omitted them
/// (e.g. CD rip builds tags without re-probing the encoded file).
fn fill_missing_audio_properties(track: &mut TrackInput) {
    if track.sample_rate.is_some() && track.bitrate.is_some() && track.codec.is_some() {
        return;
    }
    let audio = audio_properties::read_audio_properties(Path::new(&track.file_path));
    if track.sample_rate.is_none() {
        track.sample_rate = audio.sample_rate;
    }
    if track.bitrate.is_none() {
        track.bitrate = audio.bitrate;
    }
    if track.codec.is_none() {
        track.codec = audio.codec;
    }
}

#[tauri::command]
pub fn save_track(
    app: AppHandle,
    state: State<DbState>,
    mut track: TrackInput,
) -> Result<Track, String> {
    fill_missing_audio_properties(&mut track);
    let library = settings::resolved_library_settings(&app);
    let root = PathBuf::from(&library.library_root);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // Copies land in the tracks folder (managed); references resolve by location.
    let source_id = sources::source_for_path(
        &conn,
        &LibraryRoots::from_settings(&library),
        Path::new(&track.file_path),
    )
    .map_err(|e| e.to_string())?;
    let id = db::save_track(&conn, &track, source_id).map_err(|e| {
        eprintln!("save_track error: {e}");
        e.to_string()
    })?;
    lyrics_normalize::persist_import_lyrics(&conn, id, &track.lyrics).map_err(|e| {
        eprintln!("persist_import_lyrics error: {e}");
        e.to_string()
    })?;
    track_for_ui(&conn, &root, id)
}

#[tauri::command]
pub fn get_library(app: AppHandle, state: State<DbState>) -> Result<Vec<Track>, String> {
    let library_root = library_root(&app);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut tracks = db::get_all_tracks(&conn).map_err(|e| {
        eprintln!("get_library error: {e}");
        e.to_string()
    })?;
    crate::artwork_paths::hydrate_tracks_art_paths(&library_root, &mut tracks);
    Ok(tracks)
}

const REFRESH_METADATA_MAX_ERRORS: usize = 20;

fn refresh_library_metadata_blocking(
    app: &AppHandle,
) -> Result<RefreshLibraryMetadataResult, String> {
    let app_data = settings::app_data_dir(app)?;
    let library_root = PathBuf::from(settings::resolved_library_settings(app).library_root);
    let state = app.state::<DbState>();
    let tracks = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        db::get_all_tracks(&conn).map_err(|e| {
            eprintln!("refresh_library_metadata get_all_tracks error: {e}");
            e.to_string()
        })?
    };

    let mut updated = 0u32;
    let mut missing = 0u32;
    let mut failed = 0u32;
    let mut errors = Vec::new();

    for track in tracks {
        let label = if track.title.is_empty() {
            track.file_path.clone()
        } else {
            track.title.clone()
        };

        if !Path::new(&track.file_path).is_file() {
            missing += 1;
            if errors.len() < REFRESH_METADATA_MAX_ERRORS {
                errors.push(format!("{label}: File not found"));
            }
            continue;
        }

        let lyrics_sidecar_enabled = settings::lyrics_sidecar_sync_enabled(app);
        let parse_result = metadata_reader::parse_track_metadata_for_library(
            &app_data,
            &track.file_path,
            lyrics_sidecar_enabled,
            Some(&library_root),
        );
        let mut input = match parse_result {
            Ok(input) => input,
            Err(err) => {
                failed += 1;
                if errors.len() < REFRESH_METADATA_MAX_ERRORS {
                    errors.push(format!("{label}: {err}"));
                }
                continue;
            }
        };
        // Art is reconstructed per-album after all tracks are parsed.
        input.art_path = track.art_path.clone();

        let save_result = {
            let conn = state.0.lock().map_err(|e| e.to_string())?;
            db::save_track(&conn, &input, track.source_id)
        };

        match save_result {
            Ok(_) => updated += 1,
            Err(err) => {
                failed += 1;
                if errors.len() < REFRESH_METADATA_MAX_ERRORS {
                    errors.push(format!("{label}: {err}"));
                }
            }
        }
    }

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        if let Err(err) =
            crate::artwork_extract::reconstruct_all_album_artwork(&conn, &library_root)
        {
            eprintln!("refresh reconstruct artwork: {err}");
            if errors.len() < REFRESH_METADATA_MAX_ERRORS {
                errors.push(format!("Artwork rebuild: {err}"));
            }
            failed = failed.saturating_add(1);
        }
    }

    Ok(RefreshLibraryMetadataResult {
        updated,
        missing,
        failed,
        errors,
    })
}

#[tauri::command]
pub async fn refresh_library_metadata(
    app: AppHandle,
) -> Result<RefreshLibraryMetadataResult, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || refresh_library_metadata_blocking(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn record_listen_event(
    app: AppHandle,
    state: State<DbState>,
    event: ListenEventInput,
) -> Result<RecordListenEventResult, String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    if !settings::listening_history_enabled(&app) {
        return db::skip_listen_event_recording(&conn, event.track_id).map_err(|e| {
            eprintln!("skip_listen_event_recording error: {e}");
            e.to_string()
        });
    }
    db::record_listen_event(&mut conn, &event).map_err(|e| {
        eprintln!("record_listen_event error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn clear_listen_history(
    state: State<DbState>,
    within_hours: Option<u32>,
) -> Result<ClearListenHistoryResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::clear_listen_events(&conn, within_hours).map_err(|e| {
        eprintln!("clear_listen_history error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn set_track_rating(
    app: AppHandle,
    state: State<DbState>,
    rating_sync: State<RatingSync>,
    track_id: i64,
    rating: u8,
) -> Result<u8, String> {
    let (saved_rating, file_path) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        save_rating(&conn, track_id, rating)?
    };

    if let Some(file_path) = file_path {
        schedule_rating_file_write(app, &rating_sync, track_id, file_path, saved_rating);
    }

    Ok(saved_rating)
}

/// Save a rating in the library. Returns the saved rating and the file to
/// write the rating tag to, or `None` when the track's source is read-only and
/// the rating lives in the library only.
fn save_rating(
    conn: &rusqlite::Connection,
    track_id: i64,
    rating: u8,
) -> Result<(u8, Option<String>), String> {
    let saved_rating = db::set_track_rating(conn, track_id, rating).map_err(|e| {
        eprintln!("set_track_rating error: {e}");
        e.to_string()
    })?;
    let file_path = db::get_track_by_id(conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track {track_id} not found after rating update"))?
        .file_path;
    let writable = track_permissions(conn, track_id)?.writable;
    Ok((saved_rating, writable.then_some(file_path)))
}

#[tauri::command]
pub fn remove_track(
    app: AppHandle,
    state: State<DbState>,
    track_id: i64,
    delete_from_disk: bool,
) -> Result<(), String> {
    let (track, perms) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let track = db::get_track_by_id(&conn, track_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track {track_id} not found"))?;
        let perms = track_permissions(&conn, track_id)?;
        db::delete_track(&conn, track_id).map_err(|e| e.to_string())?;
        (track, perms)
    };

    if delete_from_disk {
        delete_removed_track_file(
            perms,
            Path::new(&track.file_path),
            settings::lyrics_sidecar_sync_enabled(&app),
        )?;
    }

    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);

    if let Ok(app_data) = app.path().app_data_dir() {
        let _ = art_cache::remove_cached_art(&app_data, &track.file_path);
    }

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        if let Err(err) =
            crate::artwork_organize::gc_art_after_track_removed(&conn, &library_root, &track)
        {
            eprintln!("artwork GC after remove_track: {err}");
        }
    }

    Ok(())
}

/// Delete a removed track's file and lyrics sidecar. Only Spiral's own files
/// are deleted: for any other source the request is ignored and the file stays,
/// so removing a mixed selection still removes every row. Returns whether the
/// file was deleted.
fn delete_removed_track_file(
    perms: TrackPermissions,
    audio_path: &Path,
    sidecar_enabled: bool,
) -> Result<bool, String> {
    if !perms.managed {
        return Ok(false);
    }
    if sidecar_enabled {
        lyrics_sidecar::remove_sidecar(audio_path)?;
    }
    if !audio_path.exists() {
        return Ok(false);
    }
    fs::remove_file(audio_path).map_err(|e| format!("Failed to delete audio file: {e}"))?;
    Ok(true)
}

/// Replacing overwrites or deletes the old file, so it is refused for files
/// Spiral doesn't own. Re-pointing the track at a new copy instead would leave
/// the original behind for the next scan to add again as a duplicate.
fn ensure_replace_allowed(perms: TrackPermissions) -> Result<(), String> {
    perms.require_managed("Replacing the file")
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
    crate::path_scope::ensure_allowed(&app, &source_path)?;
    let resolved = settings::resolved_library_settings(&app);
    let sidecar_enabled = settings::lyrics_sidecar_sync_enabled(&app);

    let (existing, mut metadata) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let existing = db::get_track_by_id(&conn, track_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track {track_id} not found"))?;
        ensure_replace_allowed(track_permissions(&conn, track_id)?)?;
        let metadata = track_input_to_metadata(&track);
        (existing, metadata)
    };

    let old_path = PathBuf::from(&existing.file_path);
    let new_path = import_files::prepare_import_file(
        &source_path,
        &mode,
        resolved.auto_organize,
        &resolved.media_folder,
        &resolved.organize_path_format,
        sidecar_enabled,
        Some(&old_path),
    )?;

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

    let (canonical_lyrics, new_perms) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        db::update_track(
            &conn,
            track_id,
            &metadata,
            Some(new_path.as_str()),
            Some(&audio_properties::read_audio_properties(Path::new(
                &new_path,
            ))),
        )
        .map_err(|e| {
            eprintln!("replace_track_from_import update error: {e}");
            e.to_string()
        })?;
        sources::source_for_path(
            &conn,
            &LibraryRoots::from_settings(&resolved),
            &new_path_buf,
        )
        .and_then(|source_id| db::set_track_source(&conn, track_id, source_id))
        .map_err(|e| e.to_string())?;
        lyrics_normalize::persist_import_lyrics(&conn, track_id, &track.lyrics).map_err(|e| {
            eprintln!("persist_import_lyrics error: {e}");
            e.to_string()
        })?;
        let lyrics = db::get_track_lyrics(&conn, track_id)
            .map_err(|e| e.to_string())?
            .map(lyrics_normalize::track_lyrics_record_to_input);
        (lyrics, track_permissions(&conn, track_id)?)
    };

    // A referenced replacement is not Spiral's file: leave its tags alone.
    if new_perms.writable {
        project_lyrics_to_file(&new_path_buf, canonical_lyrics.as_ref(), sidecar_enabled)?;
    }

    if old_path != new_path_buf {
        if sidecar_enabled {
            if let Err(e) = lyrics_sidecar::remove_sidecar(&old_path) {
                eprintln!("replace_track_from_import failed to remove old lyrics sidecar: {e}");
            }
        }
        let media_folder = Path::new(&resolved.media_folder);
        if path_is_under_media(media_folder, &old_path) && old_path.is_file() {
            if let Err(e) = fs::remove_file(&old_path) {
                eprintln!("replace_track_from_import failed to delete old file: {e}");
            }
        }
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    track_for_ui(&conn, Path::new(&resolved.library_root), track_id)
}

/// Project canonical DB lyrics onto an audio file (tags + sidecar). Callers
/// check the track's source is writable first.
pub(crate) fn project_lyrics_to_file(
    new_path: &Path,
    lyrics: Option<&TrackLyricsInput>,
    sidecar_enabled: bool,
) -> Result<(), String> {
    match metadata_writer::write_lyrics_projection(new_path, lyrics) {
        Ok(()) => {}
        Err(metadata_writer::MetadataWriteError::UnsupportedFormat(msg)) => {
            eprintln!("replace lyrics projection skipped: {msg}");
        }
        Err(err) => return Err(err.to_message()),
    }

    if sidecar_enabled {
        lyrics_sidecar::sync_sidecar(new_path, lyrics)?;
    }

    Ok(())
}

fn build_convert_dest_path(
    source: &Path,
    track: &Track,
    profile: &encoding_profiles::EncodingProfile,
    auto_organize: bool,
    media_folder: &Path,
    organize_path_format: &str,
) -> Result<PathBuf, String> {
    if auto_organize {
        let placeholder_name = format!("placeholder.{}", profile.extension);
        let placeholder = Path::new(&placeholder_name);
        let meta = OrganizeMetadata {
            title: track.title.as_str(),
            artist: track.artist.as_deref(),
            album: track.album.as_deref(),
            album_artist: track.album_artist.as_deref(),
            track_number: track.track_number,
            disc_number: track.disc_number,
            year: track.year,
            genre: track.genre.as_deref(),
        };
        library_organize::build_organized_path(
            media_folder,
            placeholder,
            &meta,
            organize_path_format,
        )
    } else {
        let stem = source
            .file_stem()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("track");
        Ok(media_folder.join(format!("{stem}.{}", profile.extension)))
    }
}

/// Write under the media folder so the final relocate is same-volume when possible
/// (`std::env::temp_dir()` is often a different mount on Linux, e.g. tmpfs `/tmp`).
fn convert_temp_path(media_folder: &Path, track_id: i64, extension: &str) -> PathBuf {
    media_folder
        .join(".spiral-convert")
        .join(format!("{track_id}.{extension}"))
}

#[tauri::command]
pub async fn convert_track(
    app: AppHandle,
    track_id: i64,
    profile_id: String,
    mode: String,
) -> Result<Track, String> {
    tauri::async_runtime::spawn_blocking(move || {
        convert_track_impl(&app, track_id, &profile_id, &mode)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn get_convert_profile_options(
    source_paths: Vec<String>,
) -> Result<encoding_profiles::ConvertProfileOptions, String> {
    let paths: Vec<PathBuf> = source_paths.into_iter().map(PathBuf::from).collect();
    encoding_profiles::convert_profile_options_for_sources(&paths)
}

/// Converting always writes a new file into the tracks folder. Replace mode
/// then deletes the original, so it is refused for files Spiral doesn't own;
/// add-new is allowed for any source.
fn ensure_convert_allowed(perms: TrackPermissions, mode: &str) -> Result<(), String> {
    if mode == "replace" {
        perms.require_managed("Replacing the original with a converted file")?;
    }
    Ok(())
}

fn convert_track_impl(
    app: &AppHandle,
    track_id: i64,
    profile_id: &str,
    mode: &str,
) -> Result<Track, String> {
    if track_id <= 0 {
        return Err("Cannot convert a track that is still importing".to_string());
    }

    if mode != "replace" && mode != "add_new" {
        return Err(format!("Invalid convert mode: {mode}"));
    }

    let state = app.state::<DbState>();

    let profile = encoding_profiles::profile_from_id(profile_id)?;
    let resolved = settings::resolved_library_settings(&app);

    let existing = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let existing = db::get_track_by_id(&conn, track_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track {track_id} not found"))?;
        ensure_convert_allowed(track_permissions(&conn, track_id)?, mode)?;
        existing
    };

    let source = PathBuf::from(&existing.file_path);
    if !source.is_file() {
        return Err(format!("Source file not found: {}", source.display()));
    }

    if encoding_profiles::source_matches_profile(&source, profile.id) {
        return Err(format!(
            "Track is already {} ({})",
            profile.label, profile.extension
        ));
    }

    if !encoding_profiles::can_convert_to_profile(&source, profile.id) {
        return Err("Cannot convert lossy audio to a lossless format".to_string());
    }

    let media_folder = Path::new(&resolved.media_folder);
    fs::create_dir_all(media_folder)
        .map_err(|err| format!("Failed to create media folder: {err}"))?;

    let dest_path = build_convert_dest_path(
        &source,
        &existing,
        profile,
        resolved.auto_organize,
        media_folder,
        &resolved.organize_path_format,
    )?;

    let temp_path = convert_temp_path(media_folder, track_id, profile.extension);
    if let Some(parent) = temp_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create convert temp folder: {err}"))?;
    }
    if temp_path.exists() {
        fs::remove_file(&temp_path)
            .map_err(|err| format!("Failed to clear convert temp file: {err}"))?;
    }

    let metadata = metadata_for_convert(app, &existing, &source)?;
    transcoder::transcode_file_with_metadata(&source, &temp_path, profile.id, &metadata)?;

    let final_path = library_organize::move_track_file(
        &temp_path,
        dest_path,
        resolved.lyrics_sidecar_sync_enabled,
    )
    .map_err(|err| {
        let _ = fs::remove_file(&temp_path);
        err
    })?;
    if let Some(parent) = temp_path.parent() {
        library_organize::prune_empty_dirs(parent, media_folder);
    }
    let new_path = final_path.to_string_lossy().into_owned();

    if mode == "add_new" {
        let input = track_to_input(&existing, new_path);
        let root = PathBuf::from(&resolved.library_root);
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        // Converted files are written into the tracks folder.
        let id = db::save_track(&conn, &input, sources::MANAGED_SOURCE_ID).map_err(|e| {
            eprintln!("convert_track save_track error: {e}");
            e.to_string()
        })?;
        return track_for_ui(&conn, &root, id);
    }

    let old_path = PathBuf::from(&existing.file_path);
    let mut metadata = track_to_metadata(&existing);

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
        db::update_track(
            &conn,
            track_id,
            &metadata,
            Some(new_path.as_str()),
            Some(&audio_properties::read_audio_properties(Path::new(
                &new_path,
            ))),
        )
        .map_err(|e| {
            eprintln!("convert_track update error: {e}");
            e.to_string()
        })?;
        db::set_track_source(&conn, track_id, sources::MANAGED_SOURCE_ID)
            .map_err(|e| e.to_string())?;
    }

    if old_path != final_path {
        if path_is_under_media(media_folder, &old_path) && old_path.is_file() {
            if let Err(err) = fs::remove_file(&old_path) {
                eprintln!("convert_track failed to delete old file: {err}");
            } else {
                library_organize::prune_empty_dirs(
                    old_path.parent().unwrap_or(&old_path),
                    media_folder,
                );
            }
        }
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    track_for_ui(&conn, Path::new(&resolved.library_root), track_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Track;

    fn sample_track(file_path: &str) -> Track {
        Track {
            id: 1,
            title: "Example Song".into(),
            artist: Some("Example Artist".into()),
            album: Some("Example Album".into()),
            album_artist: Some("Example Artist".into()),
            track_number: Some(3),
            total_tracks: None,
            disc_number: None,
            total_discs: None,
            year: Some(2024),
            genre: None,
            duration_seconds: Some(180.0),
            sample_rate: None,
            bitrate: None,
            codec: None,
            file_path: file_path.into(),
            art_path: None,
            date_added: "2026-01-01T00:00:00Z".into(),
            play_count: 0,
            last_played_at: None,
            rating: 0,
            lyrics_format: None,
            ..Default::default()
        }
    }

    #[test]
    fn build_convert_dest_path_uses_profile_extension_in_organize_format() {
        let track = sample_track("/media/Artist/Album/track.flac");
        let profile = encoding_profiles::profile_from_id("apple-aac").unwrap();
        let dest = build_convert_dest_path(
            Path::new("/media/Artist/Album/track.flac"),
            &track,
            profile,
            true,
            Path::new("/media"),
            "{artist}/{album}/{title}.{ext}",
        )
        .unwrap();

        assert_eq!(
            dest,
            Path::new("/media")
                .join("Example Artist")
                .join("Example Album")
                .join("Example Song.m4a")
        );
    }

    #[test]
    fn build_convert_dest_path_without_organize_uses_source_stem_and_profile_ext() {
        let track = sample_track("/media/Artist/Album/track.flac");
        let profile = encoding_profiles::profile_from_id("mp3-high").unwrap();
        let dest = build_convert_dest_path(
            Path::new("/media/Artist/Album/track.flac"),
            &track,
            profile,
            false,
            Path::new("/media"),
            "{artist}/{album}/{title}.{ext}",
        )
        .unwrap();

        assert_eq!(dest, Path::new("/media/track.mp3"));
    }

    mod source_guards {
        use super::super::*;
        use crate::track_permissions::test_support::*;
        use crate::track_permissions::SOURCE_READ_ONLY;

        fn rating_in_db(conn: &rusqlite::Connection, id: i64) -> u8 {
            db::get_track_by_id(conn, id).unwrap().unwrap().rating
        }

        #[test]
        fn rating_tag_writes_only_for_writable_sources() {
            let conn = conn();
            let t = default_source_tracks(&conn);
            for (id, path) in [(t.managed, "/m.mp3"), (t.watched_writable, "/rw.mp3")] {
                let (saved, file) = save_rating(&conn, id, 80).unwrap();
                assert_eq!(file.as_deref(), Some(path));
                assert_eq!(rating_in_db(&conn, id), saved);
            }
            for id in [t.watched_read_only, t.external] {
                let (saved, file) = save_rating(&conn, id, 80).unwrap();
                assert_eq!(file, None, "track {id} scheduled a file write");
                assert_eq!(rating_in_db(&conn, id), saved);
                assert!(saved > 0);
            }
        }

        fn audio_with_sidecar(dir: &Path, name: &str) -> (PathBuf, PathBuf) {
            let audio = dir.join(format!("{name}.mp3"));
            fs::write(&audio, b"audio").unwrap();
            let sidecar = lyrics_sidecar::sidecar_path_for(&audio);
            fs::write(&sidecar, b"[00:00.00]line\n").unwrap();
            (audio, sidecar)
        }

        #[test]
        fn delete_from_disk_only_deletes_managed_files() {
            let tmp = TempDir::new("delete");
            let conn = conn();
            let files: Vec<_> = ["m", "ro", "rw", "x"]
                .iter()
                .map(|name| audio_with_sidecar(&tmp.0, name))
                .collect();
            let t = source_tracks(&conn, &files[0].0, &files[1].0, &files[2].0, &files[3].0);

            let perms = |id| track_permissions(&conn, id).unwrap();
            assert!(delete_removed_track_file(perms(t.managed), &files[0].0, true).unwrap());
            assert!(!files[0].0.exists());
            assert!(!files[0].1.exists());

            for (id, (audio, sidecar)) in [t.watched_read_only, t.watched_writable, t.external]
                .into_iter()
                .zip(&files[1..])
            {
                assert!(!delete_removed_track_file(perms(id), audio, true).unwrap());
                assert!(audio.is_file(), "{} was deleted", audio.display());
                assert!(sidecar.is_file(), "{} was deleted", sidecar.display());
            }
        }

        #[test]
        fn replace_is_refused_for_files_spiral_does_not_own() {
            let conn = conn();
            let t = default_source_tracks(&conn);
            let perms = |id| track_permissions(&conn, id).unwrap();
            assert!(ensure_replace_allowed(perms(t.managed)).is_ok());
            for id in [t.watched_read_only, t.watched_writable, t.external] {
                let err = ensure_replace_allowed(perms(id)).unwrap_err();
                assert!(err.starts_with(SOURCE_READ_ONLY), "{err}");
            }
        }

        #[test]
        fn convert_replace_is_refused_but_add_new_is_allowed() {
            let conn = conn();
            let t = default_source_tracks(&conn);
            let perms = |id| track_permissions(&conn, id).unwrap();
            assert!(ensure_convert_allowed(perms(t.managed), "replace").is_ok());
            for id in [
                t.managed,
                t.watched_read_only,
                t.watched_writable,
                t.external,
            ] {
                assert!(ensure_convert_allowed(perms(id), "add_new").is_ok());
            }
            for id in [t.watched_read_only, t.watched_writable, t.external] {
                let err = ensure_convert_allowed(perms(id), "replace").unwrap_err();
                assert!(err.starts_with(SOURCE_READ_ONLY), "{err}");
            }
        }
    }
}
