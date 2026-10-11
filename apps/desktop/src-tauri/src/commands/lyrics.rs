use crate::commands::library::DbState;
use crate::db;
use crate::lyrics_fetch;
use crate::lyrics_normalize;
use crate::models::{
    LyricsFetchCachePeek, LyricsFetchOutcome, LyricsFormat, LyricsSource, Track, TrackLyricsInput,
    TrackLyricsRecord,
};
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
