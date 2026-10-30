use crate::commands::library::{project_lyrics_to_file, track_for_ui, DbState};
use crate::db;
use crate::lyrics_fetch;
use crate::lyrics_normalize;
use crate::models::{
    LyricsFetchCachePeek, LyricsFetchOutcome, LyricsFormat, LyricsSource, Track, TrackLyricsInput,
    TrackLyricsRecord,
};
use crate::settings;
use crate::track_permissions::track_permissions;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_track_lyrics(
    state: State<'_, DbState>,
    track_id: i64,
) -> Result<Option<TrackLyricsRecord>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_track_lyrics(&conn, track_id).map_err(|e| {
        eprintln!("get_track_lyrics error: {e}");
        e.to_string()
    })
}

/// Persist an instrumental marker in `track_lyrics` (DB only — no file tags).
#[tauri::command]
pub fn mark_track_instrumental(state: State<'_, DbState>, track_id: i64) -> Result<Track, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let input = TrackLyricsInput {
        format: LyricsFormat::Instrumental,
        source: Some(LyricsSource::Lrclib),
        lines: vec![],
        plain_text: String::new(),
    };
    let record = lyrics_normalize::track_lyrics_input_to_record(input, track_id);
    db::upsert_track_lyrics(&conn, &record).map_err(|e| {
        eprintln!("mark_track_instrumental upsert error: {e}");
        e.to_string()
    })?;
    db::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track {track_id} not found after marking instrumental"))
}

/// Save lyrics fetched for a track. They always go into the library; the
/// file's tags and sidecar are updated only when the track's source is
/// writable, and silently left alone otherwise.
#[tauri::command]
pub fn save_track_lyrics(
    app: AppHandle,
    state: State<'_, DbState>,
    track_id: i64,
    lyrics: Option<TrackLyricsInput>,
) -> Result<Track, String> {
    save_lyrics(
        &state,
        track_id,
        lyrics.as_ref(),
        settings::lyrics_sidecar_sync_enabled(&app),
    )?;
    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    track_for_ui(&conn, &library_root, track_id)
}

fn save_lyrics(
    state: &DbState,
    track_id: i64,
    lyrics: Option<&TrackLyricsInput>,
    sidecar_enabled: bool,
) -> Result<(), String> {
    let (file_path, perms) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let track = db::get_track_by_id(&conn, track_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track {track_id} not found"))?;
        (track.file_path, track_permissions(&conn, track_id)?)
    };
    if perms.writable {
        project_lyrics_to_file(Path::new(&file_path), lyrics, sidecar_enabled)?;
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    lyrics_normalize::save_track_lyrics(&conn, track_id, lyrics).map_err(|e| {
        eprintln!("save_track_lyrics error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub async fn fetch_lyrics_lrclib(
    app: AppHandle,
    artist: String,
    album_artist: String,
    title: String,
    album: String,
    duration_seconds: Option<f64>,
    respect_miss_cache: Option<bool>,
) -> Result<LyricsFetchOutcome, String> {
    let app = app.clone();
    let respect_miss_cache = respect_miss_cache.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        lyrics_fetch::fetch_lyrics_lrclib_cached(
            &app,
            artist,
            album_artist,
            title,
            album,
            duration_seconds,
            respect_miss_cache,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop further LRCLIB strategy attempts for an in-flight lyrics fetch.
#[tauri::command]
pub fn cancel_lyrics_fetch() {
    lyrics_fetch::request_cancel();
}

/// Clear a prior lyrics-fetch cancel request.
#[tauri::command]
pub fn clear_lyrics_fetch_cancel() {
    lyrics_fetch::clear_cancel();
}

#[tauri::command]
pub async fn peek_lyrics_fetch_cache(
    app: AppHandle,
    artist: String,
    title: String,
    duration_seconds: Option<f64>,
) -> Result<LyricsFetchCachePeek, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        lyrics_fetch::peek_lyrics_fetch_cache(&app, artist, title, duration_seconds)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lyrics_sidecar::sidecar_path_for;
    use crate::models::LyricsLine;
    use crate::test_fixtures::ogg;
    use crate::track_permissions::test_support::*;
    use std::sync::Mutex;

    fn synced() -> TrackLyricsInput {
        TrackLyricsInput {
            format: LyricsFormat::LineSynced,
            source: Some(LyricsSource::Lrclib),
            lines: vec![LyricsLine {
                text: "Fetched line".into(),
                start_ms: Some(1_000),
                end_ms: None,
                words: None,
            }],
            plain_text: "Fetched line".into(),
        }
    }

    #[test]
    fn fetched_lyrics_reach_the_file_only_when_writable() {
        let tmp = TempDir::new("lyrics");
        let files: Vec<_> = ["m", "ro", "rw", "x"]
            .iter()
            .map(|name| ogg::copy_minimal(&tmp.0, &format!("{name}.ogg")))
            .collect();
        let conn = conn();
        let t = source_tracks(&conn, &files[0], &files[1], &files[2], &files[3]);
        let state = DbState(Mutex::new(conn));
        let lyrics = synced();

        for (id, file, writable) in [
            (t.managed, &files[0], true),
            (t.watched_read_only, &files[1], false),
            (t.watched_writable, &files[2], true),
            (t.external, &files[3], false),
        ] {
            let before = std::fs::read(file).unwrap();
            save_lyrics(&state, id, Some(&lyrics), true).unwrap();

            let stored = db::get_track_lyrics(&state.0.lock().unwrap(), id).unwrap();
            assert_eq!(stored.unwrap().plain_text, "Fetched line");
            let changed = std::fs::read(file).unwrap() != before;
            assert_eq!(changed, writable, "{}", file.display());
            assert_eq!(sidecar_path_for(file).is_file(), writable);
        }
    }
}
