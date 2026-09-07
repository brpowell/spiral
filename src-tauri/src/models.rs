use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub total_tracks: Option<i32>,
    pub disc_number: Option<i32>,
    pub total_discs: Option<i32>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub duration_seconds: Option<f64>,
    pub sample_rate: Option<u32>,
    pub bitrate: Option<u32>,
    pub codec: Option<String>,
    pub file_path: String,
    pub art_path: Option<String>,
    pub date_added: String,
    pub play_count: u32,
    pub last_played_at: Option<String>,
    pub rating: u8,
    #[serde(default)]
    pub lyrics_format: Option<LyricsFormat>,
    /// MusicBrainz recording UUID. File tag is `MUSICBRAINZ_TRACKID` (Picard: the
    /// Vorbis name says “track” but the value is a recording — not the release-track entity).
    #[serde(default)]
    pub recording_mbid: Option<String>,
    #[serde(default)]
    pub release_mbid: Option<String>,
    #[serde(default)]
    pub artist_mbids: Vec<String>,
    #[serde(default)]
    pub album_artist_mbids: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMetadataUpdate {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub total_tracks: Option<i32>,
    pub disc_number: Option<i32>,
    pub total_discs: Option<i32>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub art_path: Option<String>,
    /// When true, embed or remove cover art in the audio file. When false, leave embedded art unchanged.
    #[serde(default)]
    pub art_changed: bool,
    pub lyrics: Option<TrackLyricsInput>,
    /// When true, embed or remove lyrics in the audio file and sync `track_lyrics`.
    #[serde(default)]
    pub lyrics_changed: bool,
    #[serde(default)]
    pub recording_mbid: Option<String>,
    #[serde(default)]
    pub release_mbid: Option<String>,
    #[serde(default)]
    pub artist_mbids: Vec<String>,
    #[serde(default)]
    pub album_artist_mbids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaylistImageMode {
    Generated,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub date_created: String,
    pub last_used_at: String,
    pub track_ids: Vec<i64>,
    pub image_mode: PlaylistImageMode,
    pub custom_image_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistImage {
    pub artist_key: String,
    pub art_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshLibraryMetadataResult {
    pub updated: u32,
    pub missing: u32,
    pub failed: u32,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LyricsFormat {
    Plain,
    LineSynced,
    WordSynced,
    /// LRCLIB (or user) marked this track as instrumental — no lyrics to fetch.
    Instrumental,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LyricsSource {
    Manual,
    Embedded,
    Sidecar,
    Lrclib,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsWord {
    pub text: String,
    pub start_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsLine {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<LyricsWord>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackLyricsInput {
    pub format: LyricsFormat,
    pub source: Option<LyricsSource>,
    pub lines: Vec<LyricsLine>,
    pub plain_text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsSearchCandidate {
    pub id: i64,
    pub track_name: String,
    pub artist_name: String,
    pub album_name: String,
    pub duration: f64,
    pub lyrics: TrackLyricsInput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LyricsFetchCachePeek {
    NotCached,
    Miss,
    Hit,
    Instrumental,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LyricsFetchOutcome {
    Found {
        lyrics: TrackLyricsInput,
    },
    NotFound,
    /// LRCLIB reports this recording as instrumental.
    Instrumental,
    Ambiguous {
        candidates: Vec<LyricsSearchCandidate>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackLyricsRecord {
    pub track_id: i64,
    pub format: LyricsFormat,
    pub source: Option<LyricsSource>,
    pub lines: Vec<LyricsLine>,
    pub plain_text: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInput {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub total_tracks: Option<i32>,
    pub disc_number: Option<i32>,
    pub total_discs: Option<i32>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub duration_seconds: Option<f64>,
    pub sample_rate: Option<u32>,
    pub bitrate: Option<u32>,
    pub codec: Option<String>,
    pub file_path: String,
    pub art_path: Option<String>,
    pub rating: Option<u8>,
    pub lyrics: Option<TrackLyricsInput>,
    #[serde(default)]
    pub recording_mbid: Option<String>,
    #[serde(default)]
    pub release_mbid: Option<String>,
    #[serde(default)]
    pub artist_mbids: Vec<String>,
    #[serde(default)]
    pub album_artist_mbids: Vec<String>,
}

/// Append-only listen history row written when a library play closes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenEventInput {
    pub track_id: i64,
    pub started_at: String,
    pub ended_at: String,
    pub listened_seconds: f64,
    #[serde(default)]
    pub library_listened_seconds: f64,
    #[serde(default)]
    pub skin_listened_seconds: f64,
    pub track_duration_seconds: Option<f64>,
    /// `natural_end` | `skipped` | `interrupted`
    pub completion: String,
    /// Currently always `library` (CD later).
    #[serde(default = "default_listen_source")]
    pub source: String,
    /// Majority UI surface by listened seconds: `library` | `skin`.
    #[serde(default = "default_listen_ui_mode")]
    pub ui_mode: String,
    pub theme_id: Option<String>,
    pub theme_name: Option<String>,
    pub skin_id: Option<String>,
    pub skin_name: Option<String>,
    pub visualizer_id: Option<String>,
    pub visualizer_name: Option<String>,
}

fn default_listen_source() -> String {
    "library".into()
}

fn default_listen_ui_mode() -> String {
    "library".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordListenEventResult {
    pub event_id: i64,
    pub play_count: u32,
    pub last_played_at: String,
    /// True when this close qualified as a play and bumped `play_count`.
    #[serde(default)]
    pub counted: bool,
    /// False when recording is disabled and nothing was inserted.
    #[serde(default = "default_true")]
    pub recorded: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearListenHistoryResult {
    pub deleted_events: u64,
    pub reset_counters: bool,
}
