use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub rating: u8,
    #[serde(default)]
    pub lyrics_format: Option<LyricsFormat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub browse_mode: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
}
