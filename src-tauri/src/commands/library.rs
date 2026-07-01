use crate::art_cache;
use crate::db;
use crate::encoding_profiles;
use crate::import_files;
use crate::library_organize::{self, OrganizeMetadata};
use crate::audio_properties;
use crate::metadata_reader;
use crate::models::{Track, TrackInput, TrackMetadataUpdate};
use crate::rating_sync::{schedule_rating_file_write, RatingSync};
use crate::settings;
use crate::transcoder;
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

fn track_to_metadata(track: &Track) -> TrackMetadataUpdate {
    TrackMetadataUpdate {
        title: track.title.clone(),
        artist: track.artist.clone(),
        album: track.album.clone(),
        album_artist: track.album_artist.clone(),
        track_number: track.track_number,
        disc_number: track.disc_number,
        year: track.year,
        genre: track.genre.clone(),
        art_path: track.art_path.clone(),
        art_changed: false,
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
        disc_number: track.disc_number,
        year: track.year,
        genre: track.genre.clone(),
        duration_seconds: track.duration_seconds,
        sample_rate: audio.sample_rate,
        bitrate: audio.bitrate,
        codec: audio.codec,
        file_path,
        art_path: track.art_path.clone(),
        rating: Some(track.rating),
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
    match metadata_reader::parse_track_metadata(&app_data, source_path.as_ref()) {
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
pub fn set_track_rating(
    app: AppHandle,
    state: State<DbState>,
    rating_sync: State<RatingSync>,
    track_id: i64,
    rating: u8,
) -> Result<u8, String> {
    let (saved_rating, file_path) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let saved_rating = db::set_track_rating(&conn, track_id, rating).map_err(|e| {
            eprintln!("set_track_rating error: {e}");
            e.to_string()
        })?;
        let file_path = db::get_track_by_id(&conn, track_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track {track_id} not found after rating update"))?
            .file_path;
        (saved_rating, file_path)
    };

    schedule_rating_file_write(app, &rating_sync, track_id, file_path, saved_rating);

    Ok(saved_rating)
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
        db::update_track(
            &conn,
            track_id,
            &metadata,
            Some(new_path.as_str()),
            Some(&audio_properties::read_audio_properties(Path::new(&new_path))),
        )
        .map_err(|e| {
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

fn convert_temp_path(track_id: i64, extension: &str) -> PathBuf {
    std::env::temp_dir()
        .join("spiral-convert")
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
    let backup_config = settings::metadata_backup_config(&app);

    let existing = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        db::get_track_by_id(&conn, track_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track {track_id} not found"))?
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

    let temp_path = convert_temp_path(track_id, profile.extension);
    if let Some(parent) = temp_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create convert temp folder: {err}"))?;
    }
    if temp_path.exists() {
        fs::remove_file(&temp_path)
            .map_err(|err| format!("Failed to clear convert temp file: {err}"))?;
    }

    let metadata = metadata_for_convert(app, &existing, &source)?;
    transcoder::transcode_file_with_metadata(
        &source,
        &temp_path,
        profile.id,
        &metadata,
        &backup_config,
    )?;

    let final_path =
        library_organize::move_track_file(&temp_path, dest_path).map_err(|err| {
            let _ = fs::remove_file(&temp_path);
            err
        })?;
    let new_path = final_path.to_string_lossy().into_owned();

    if mode == "add_new" {
        let input = track_to_input(&existing, new_path);
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let id = db::save_track(&conn, &input).map_err(|e| {
            eprintln!("convert_track save_track error: {e}");
            e.to_string()
        })?;
        return db::get_track_by_id(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track {id} not found after convert"));
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
            Some(&audio_properties::read_audio_properties(Path::new(&new_path))),
        )
        .map_err(|e| {
            eprintln!("convert_track update error: {e}");
            e.to_string()
        })?;
    }

    if old_path != final_path {
        if path_is_under_media(media_folder, &old_path) && old_path.is_file() {
            if let Err(err) = fs::remove_file(&old_path) {
                eprintln!("convert_track failed to delete old file: {err}");
            } else {
                library_organize::prune_empty_dirs(old_path.parent().unwrap_or(&old_path), media_folder);
            }
        }
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track {track_id} not found after convert"))
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
            disc_number: None,
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
            rating: 0,
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
}
