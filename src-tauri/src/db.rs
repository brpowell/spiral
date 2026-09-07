use crate::audio_properties::AudioProperties;
use crate::models::{
    ArtistImage, ClearListenHistoryResult, ListenEventInput, LyricsFormat, LyricsLine,
    LyricsSource, Playlist, PlaylistImageMode, RecordListenEventResult, Track, TrackInput,
    TrackLyricsRecord, TrackMetadataUpdate,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashMap;
use std::path::Path;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  album_artist TEXT,
  track_number INTEGER,
  total_tracks INTEGER,
  disc_number INTEGER,
  total_discs INTEGER,
  year INTEGER,
  genre TEXT,
  duration_seconds REAL,
  sample_rate INTEGER,
  bitrate INTEGER,
  codec TEXT,
  file_path TEXT NOT NULL UNIQUE,
  art_path TEXT,
  date_added TEXT NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played_at TEXT,
  rating INTEGER NOT NULL DEFAULT 0,
  recording_mbid TEXT,
  release_mbid TEXT,
  artist_mbids TEXT,
  album_artist_mbids TEXT
);

CREATE TABLE IF NOT EXISTS listen_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  listened_seconds REAL NOT NULL,
  library_listened_seconds REAL NOT NULL DEFAULT 0,
  skin_listened_seconds REAL NOT NULL DEFAULT 0,
  track_duration_seconds REAL,
  completion TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'library',
  ui_mode TEXT NOT NULL DEFAULT 'library',
  theme_id TEXT,
  theme_name TEXT,
  skin_id TEXT,
  skin_name TEXT,
  visualizer_id TEXT,
  visualizer_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_listen_events_ended_at ON listen_events(ended_at);
CREATE INDEX IF NOT EXISTS idx_listen_events_track_id ON listen_events(track_id);

CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  date_created TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS artist_images (
  artist_key TEXT NOT NULL PRIMARY KEY,
  art_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS track_lyrics (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  format TEXT NOT NULL DEFAULT 'plain',
  source TEXT,
  lines_json TEXT NOT NULL,
  plain_text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS musicbrainz_entities (
  kind TEXT NOT NULL,
  mbid TEXT NOT NULL,
  json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (kind, mbid)
);
";

const TRACK_SELECT: &str = "SELECT tracks.id, tracks.title, tracks.artist, tracks.album, tracks.album_artist, tracks.track_number, tracks.total_tracks, tracks.disc_number, tracks.total_discs,
                tracks.year, tracks.genre, tracks.duration_seconds, tracks.sample_rate, tracks.bitrate, tracks.codec, tracks.file_path, tracks.art_path,
                tracks.date_added, tracks.play_count, tracks.last_played_at, tracks.rating,
                tracks.recording_mbid, tracks.release_mbid, tracks.artist_mbids, tracks.album_artist_mbids, track_lyrics.format";

const TRACK_FROM_JOIN: &str =
    "FROM tracks LEFT JOIN track_lyrics ON track_lyrics.track_id = tracks.id";

fn map_track_row(row: &Row<'_>) -> rusqlite::Result<Track> {
    Ok(Track {
        id: row.get(0)?,
        title: row.get(1)?,
        artist: row.get(2)?,
        album: row.get(3)?,
        album_artist: row.get(4)?,
        track_number: row.get(5)?,
        total_tracks: row.get(6)?,
        disc_number: row.get(7)?,
        total_discs: row.get(8)?,
        year: row.get(9)?,
        genre: row.get(10)?,
        duration_seconds: row.get(11)?,
        sample_rate: row.get(12)?,
        bitrate: row.get(13)?,
        codec: row.get(14)?,
        file_path: row.get(15)?,
        art_path: row.get(16)?,
        date_added: row.get(17)?,
        play_count: row.get(18)?,
        last_played_at: row.get(19)?,
        rating: row.get(20)?,
        recording_mbid: crate::mbid::normalize_mbid(row.get::<_, Option<String>>(21)?.as_deref()),
        release_mbid: crate::mbid::normalize_mbid(row.get::<_, Option<String>>(22)?.as_deref()),
        artist_mbids: crate::mbid::parse_mbid_list(row.get::<_, Option<String>>(23)?.as_deref()),
        album_artist_mbids: crate::mbid::parse_mbid_list(
            row.get::<_, Option<String>>(24)?.as_deref(),
        ),
        lyrics_format: row
            .get::<_, Option<String>>(25)?
            .map(|value| parse_lyrics_format(&value)),
    })
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, rusqlite::Error> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
}

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>, rusqlite::Error> {
    let sql = format!("PRAGMA table_info({table})");
    let mut stmt = conn.prepare(&sql)?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(columns)
}

fn parse_playlist_image_mode(value: &str) -> PlaylistImageMode {
    match value {
        "custom" => PlaylistImageMode::Custom,
        _ => PlaylistImageMode::Generated,
    }
}

fn playlist_image_mode_str(mode: PlaylistImageMode) -> &'static str {
    match mode {
        PlaylistImageMode::Generated => "generated",
        PlaylistImageMode::Custom => "custom",
    }
}

fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    let track_columns = table_columns(conn, "tracks")?;

    if !track_columns.iter().any(|c| c == "date_added") {
        conn.execute(
            "ALTER TABLE tracks ADD COLUMN date_added TEXT NOT NULL DEFAULT ''",
            [],
        )?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE tracks SET date_added = ?1 WHERE date_added = ''",
            params![now],
        )?;
    }

    if !track_columns.iter().any(|c| c == "play_count") {
        conn.execute(
            "ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    if !track_columns.iter().any(|c| c == "last_played_at") {
        conn.execute("ALTER TABLE tracks ADD COLUMN last_played_at TEXT", [])?;
    }

    if !track_columns.iter().any(|c| c == "rating") {
        conn.execute(
            "ALTER TABLE tracks ADD COLUMN rating INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    if !track_columns.iter().any(|c| c == "sample_rate") {
        conn.execute("ALTER TABLE tracks ADD COLUMN sample_rate INTEGER", [])?;
    }
    if !track_columns.iter().any(|c| c == "bitrate") {
        conn.execute("ALTER TABLE tracks ADD COLUMN bitrate INTEGER", [])?;
    }
    if !track_columns.iter().any(|c| c == "codec") {
        conn.execute("ALTER TABLE tracks ADD COLUMN codec TEXT", [])?;
    }
    if !track_columns.iter().any(|c| c == "total_tracks") {
        conn.execute("ALTER TABLE tracks ADD COLUMN total_tracks INTEGER", [])?;
    }
    if !track_columns.iter().any(|c| c == "total_discs") {
        conn.execute("ALTER TABLE tracks ADD COLUMN total_discs INTEGER", [])?;
    }
    if !track_columns.iter().any(|c| c == "recording_mbid") {
        conn.execute("ALTER TABLE tracks ADD COLUMN recording_mbid TEXT", [])?;
    }
    if !track_columns.iter().any(|c| c == "release_mbid") {
        conn.execute("ALTER TABLE tracks ADD COLUMN release_mbid TEXT", [])?;
    }
    if !track_columns.iter().any(|c| c == "artist_mbids") {
        conn.execute("ALTER TABLE tracks ADD COLUMN artist_mbids TEXT", [])?;
    }
    if !track_columns.iter().any(|c| c == "album_artist_mbids") {
        conn.execute("ALTER TABLE tracks ADD COLUMN album_artist_mbids TEXT", [])?;
    }

    let playlist_columns = table_columns(conn, "playlists")?;
    if !playlist_columns.iter().any(|c| c == "image_mode") {
        conn.execute(
            "ALTER TABLE playlists ADD COLUMN image_mode TEXT NOT NULL DEFAULT 'generated'",
            [],
        )?;
    }
    if !playlist_columns.iter().any(|c| c == "custom_image_path") {
        conn.execute(
            "ALTER TABLE playlists ADD COLUMN custom_image_path TEXT",
            [],
        )?;
    }
    if !playlist_columns.iter().any(|c| c == "position") {
        conn.execute(
            "ALTER TABLE playlists ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
        let ids: Vec<i64> = {
            let mut stmt =
                conn.prepare("SELECT id FROM playlists ORDER BY title COLLATE NOCASE, id ASC")?;
            let ids = stmt
                .query_map([], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()?;
            ids
        };
        for (position, id) in ids.iter().enumerate() {
            conn.execute(
                "UPDATE playlists SET position = ?1 WHERE id = ?2",
                params![position as i64, id],
            )?;
        }
    }

    if !table_exists(conn, "track_lyrics")? {
        conn.execute_batch(
            "CREATE TABLE track_lyrics (
                track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
                format TEXT NOT NULL DEFAULT 'plain',
                source TEXT,
                lines_json TEXT NOT NULL,
                plain_text TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );",
        )?;
    }

    if !table_exists(conn, "listen_events")? {
        conn.execute_batch(
            "CREATE TABLE listen_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                started_at TEXT NOT NULL,
                ended_at TEXT NOT NULL,
                listened_seconds REAL NOT NULL,
                library_listened_seconds REAL NOT NULL DEFAULT 0,
                skin_listened_seconds REAL NOT NULL DEFAULT 0,
                track_duration_seconds REAL,
                completion TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'library',
                ui_mode TEXT NOT NULL DEFAULT 'library',
                theme_id TEXT,
                theme_name TEXT,
                skin_id TEXT,
                skin_name TEXT,
                visualizer_id TEXT,
                visualizer_name TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_listen_events_ended_at ON listen_events(ended_at);
            CREATE INDEX IF NOT EXISTS idx_listen_events_track_id ON listen_events(track_id);",
        )?;
    } else {
        let listen_columns = table_columns(conn, "listen_events")?;
        if !listen_columns.iter().any(|c| c == "ui_mode") {
            conn.execute(
                "ALTER TABLE listen_events ADD COLUMN ui_mode TEXT NOT NULL DEFAULT 'library'",
                [],
            )?;
        }
        if !listen_columns
            .iter()
            .any(|c| c == "library_listened_seconds")
        {
            conn.execute(
                "ALTER TABLE listen_events ADD COLUMN library_listened_seconds REAL NOT NULL DEFAULT 0",
                [],
            )?;
            // Best-effort backfill: attribute prior totals to the stamped ui_mode.
            conn.execute(
                "UPDATE listen_events SET library_listened_seconds = listened_seconds
                 WHERE ui_mode = 'library' OR ui_mode IS NULL OR ui_mode = ''",
                [],
            )?;
        }
        if !listen_columns.iter().any(|c| c == "skin_listened_seconds") {
            conn.execute(
                "ALTER TABLE listen_events ADD COLUMN skin_listened_seconds REAL NOT NULL DEFAULT 0",
                [],
            )?;
            conn.execute(
                "UPDATE listen_events SET skin_listened_seconds = listened_seconds
                 WHERE ui_mode = 'skin'",
                [],
            )?;
        }
        if !listen_columns.iter().any(|c| c == "theme_name") {
            conn.execute("ALTER TABLE listen_events ADD COLUMN theme_name TEXT", [])?;
        }
        if listen_columns.iter().any(|c| c == "skin_view_id") {
            // Drop unused Phase 1 column (SQLite 3.35+).
            let _ = conn.execute("ALTER TABLE listen_events DROP COLUMN skin_view_id", []);
        }
    }

    if !table_exists(conn, "musicbrainz_entities")? {
        conn.execute_batch(
            "CREATE TABLE musicbrainz_entities (
                kind TEXT NOT NULL,
                mbid TEXT NOT NULL,
                json TEXT NOT NULL,
                fetched_at TEXT NOT NULL,
                PRIMARY KEY (kind, mbid)
            );",
        )?;
    }

    Ok(())
}

/// Cached MusicBrainz entity document (release / recording / artist).
pub fn get_musicbrainz_entity_json(
    conn: &Connection,
    kind: &str,
    mbid: &str,
) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row(
        "SELECT json FROM musicbrainz_entities WHERE kind = ?1 AND mbid = ?2",
        params![kind, mbid],
        |row| row.get(0),
    )
    .optional()
}

/// Overwrite (or insert) a MusicBrainz entity document.
pub fn upsert_musicbrainz_entity(
    conn: &Connection,
    kind: &str,
    mbid: &str,
    json: &str,
    fetched_at: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO musicbrainz_entities (kind, mbid, json, fetched_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(kind, mbid) DO UPDATE SET
            json = excluded.json,
            fetched_at = excluded.fetched_at",
        params![kind, mbid, json, fetched_at],
    )?;
    Ok(())
}

/// Insert a MusicBrainz entity only when no row exists for `(kind, mbid)`.
/// Returns `true` when a row was inserted.
pub fn insert_musicbrainz_entity_if_absent(
    conn: &Connection,
    kind: &str,
    mbid: &str,
    json: &str,
    fetched_at: &str,
) -> Result<bool, rusqlite::Error> {
    let changed = conn.execute(
        "INSERT INTO musicbrainz_entities (kind, mbid, json, fetched_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(kind, mbid) DO NOTHING",
        params![kind, mbid, json, fetched_at],
    )?;
    Ok(changed > 0)
}

pub fn open(db_path: &Path) -> Result<Connection, rusqlite::Error> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch(SCHEMA)?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn save_track(conn: &Connection, input: &TrackInput) -> Result<i64, rusqlite::Error> {
    let date_added = Utc::now().to_rfc3339();
    let rating = input.rating.unwrap_or(0);
    let (recording_mbid, release_mbid, artist_mbids, album_artist_mbids) = crate::mbid::sql_values(
        input.recording_mbid.as_deref(),
        input.release_mbid.as_deref(),
        &input.artist_mbids,
        &input.album_artist_mbids,
    );
    conn.execute(
        "INSERT INTO tracks (
            title, artist, album, album_artist, track_number, total_tracks, disc_number, total_discs,
            year, genre, duration_seconds, sample_rate, bitrate, codec,
            file_path, art_path, date_added, rating,
            recording_mbid, release_mbid, artist_mbids, album_artist_mbids
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
        ON CONFLICT(file_path) DO UPDATE SET
            title = excluded.title,
            artist = excluded.artist,
            album = excluded.album,
            album_artist = excluded.album_artist,
            track_number = excluded.track_number,
            total_tracks = excluded.total_tracks,
            disc_number = excluded.disc_number,
            total_discs = excluded.total_discs,
            year = excluded.year,
            genre = excluded.genre,
            duration_seconds = excluded.duration_seconds,
            sample_rate = excluded.sample_rate,
            bitrate = excluded.bitrate,
            codec = excluded.codec,
            art_path = excluded.art_path,
            recording_mbid = excluded.recording_mbid,
            release_mbid = excluded.release_mbid,
            artist_mbids = excluded.artist_mbids,
            album_artist_mbids = excluded.album_artist_mbids,
            rating = CASE
                WHEN tracks.rating = 0 AND excluded.rating != 0
                THEN excluded.rating
                ELSE tracks.rating
            END",
        params![
            input.title,
            input.artist,
            input.album,
            input.album_artist,
            input.track_number,
            input.total_tracks,
            input.disc_number,
            input.total_discs,
            input.year,
            input.genre,
            input.duration_seconds,
            input.sample_rate,
            input.bitrate,
            input.codec,
            input.file_path,
            input.art_path,
            date_added,
            rating,
            recording_mbid,
            release_mbid,
            artist_mbids,
            album_artist_mbids,
        ],
    )?;

    let id = conn.query_row(
        "SELECT id FROM tracks WHERE file_path = ?1",
        params![input.file_path],
        |row| row.get(0),
    )?;
    Ok(id)
}

/// Insert a listen event. Qualifying events bump `play_count` and `last_played_at`.
///
/// A close counts as a play when any of:
/// - `completion == "natural_end"`, or
/// - `listened_seconds >= 30`, or
/// - `listened_seconds >= 50%` of known `track_duration_seconds`
///
/// Short skips are still stored; they do not inflate counters.
pub const LISTEN_QUALIFY_SECONDS: f64 = 30.0;
pub const LISTEN_QUALIFY_RATIO: f64 = 0.5;

pub fn listen_event_qualifies(event: &ListenEventInput) -> bool {
    if event.completion == "natural_end" {
        return true;
    }
    if event.listened_seconds >= LISTEN_QUALIFY_SECONDS {
        return true;
    }
    if let Some(duration) = event.track_duration_seconds {
        if duration > 0.0 && event.listened_seconds >= duration * LISTEN_QUALIFY_RATIO {
            return true;
        }
    }
    false
}

fn track_listen_counters(
    conn: &Connection,
    track_id: i64,
) -> Result<(u32, String), rusqlite::Error> {
    conn.query_row(
        "SELECT play_count, COALESCE(last_played_at, '') FROM tracks WHERE id = ?1",
        params![track_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
}

/// Return current counters without inserting (recording disabled).
pub fn skip_listen_event_recording(
    conn: &Connection,
    track_id: i64,
) -> Result<RecordListenEventResult, rusqlite::Error> {
    let (play_count, last_played_at) = track_listen_counters(conn, track_id)?;
    Ok(RecordListenEventResult {
        event_id: 0,
        play_count,
        last_played_at,
        counted: false,
        recorded: false,
    })
}

pub fn record_listen_event(
    conn: &mut Connection,
    event: &ListenEventInput,
) -> Result<RecordListenEventResult, rusqlite::Error> {
    let qualifies = listen_event_qualifies(event);
    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO listen_events (
            track_id, started_at, ended_at, listened_seconds,
            library_listened_seconds, skin_listened_seconds,
            track_duration_seconds, completion, source, ui_mode,
            theme_id, theme_name, skin_id, skin_name, visualizer_id, visualizer_name
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            event.track_id,
            event.started_at,
            event.ended_at,
            event.listened_seconds,
            event.library_listened_seconds,
            event.skin_listened_seconds,
            event.track_duration_seconds,
            event.completion,
            event.source,
            event.ui_mode,
            event.theme_id,
            event.theme_name,
            event.skin_id,
            event.skin_name,
            event.visualizer_id,
            event.visualizer_name,
        ],
    )?;
    let event_id = tx.last_insert_rowid();

    if qualifies {
        tx.execute(
            "UPDATE tracks SET
                play_count = play_count + 1,
                last_played_at = ?1
             WHERE id = ?2",
            params![event.ended_at, event.track_id],
        )?;
    }

    let (play_count, last_played_at) = track_listen_counters(&tx, event.track_id)?;

    tx.commit()?;

    Ok(RecordListenEventResult {
        event_id,
        play_count,
        last_played_at: if qualifies {
            event.ended_at.clone()
        } else {
            last_played_at
        },
        counted: qualifies,
        recorded: true,
    })
}

/// Clear listen history.
///
/// When `within_hours` is `Some(h)`, deletes events with `ended_at` in the last
/// `h` hours (browser-style “clear recent”). When `None`, deletes all events and
/// resets `play_count` / `last_played_at` on every track.
pub fn clear_listen_events(
    conn: &Connection,
    within_hours: Option<u32>,
) -> Result<ClearListenHistoryResult, rusqlite::Error> {
    let deleted = if let Some(hours) = within_hours {
        let cutoff = (Utc::now() - chrono::Duration::hours(i64::from(hours)))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let n = conn.execute(
            "DELETE FROM listen_events WHERE ended_at >= ?1",
            params![cutoff],
        )?;
        n as u64
    } else {
        let n = conn.execute("DELETE FROM listen_events", [])?;
        n as u64
    };

    let reset_counters = within_hours.is_none();
    if reset_counters {
        conn.execute(
            "UPDATE tracks SET play_count = 0, last_played_at = NULL",
            [],
        )?;
    }

    Ok(ClearListenHistoryResult {
        deleted_events: deleted,
        reset_counters,
    })
}

pub fn set_track_rating(conn: &Connection, id: i64, rating: u8) -> Result<u8, rusqlite::Error> {
    conn.execute(
        "UPDATE tracks SET rating = ?1 WHERE id = ?2",
        params![rating, id],
    )?;
    conn.query_row(
        "SELECT rating FROM tracks WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )
}

pub fn get_all_tracks(conn: &Connection) -> Result<Vec<Track>, rusqlite::Error> {
    let sql = format!(
        "{TRACK_SELECT}
         {TRACK_FROM_JOIN}
         ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_number"
    );
    let mut stmt = conn.prepare(&sql)?;

    let tracks = stmt
        .query_map([], map_track_row)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(tracks)
}

pub fn update_track(
    conn: &Connection,
    id: i64,
    metadata: &TrackMetadataUpdate,
    file_path: Option<&str>,
    audio_properties: Option<&AudioProperties>,
) -> Result<(), rusqlite::Error> {
    let (recording_mbid, release_mbid, artist_mbids, album_artist_mbids) = crate::mbid::sql_values(
        metadata.recording_mbid.as_deref(),
        metadata.release_mbid.as_deref(),
        &metadata.artist_mbids,
        &metadata.album_artist_mbids,
    );
    if let Some(path) = file_path {
        if let Some(audio) = audio_properties {
            conn.execute(
                "UPDATE tracks SET
                    title = ?1,
                    artist = ?2,
                    album = ?3,
                    album_artist = ?4,
                    track_number = ?5,
                    total_tracks = ?6,
                    disc_number = ?7,
                    total_discs = ?8,
                    year = ?9,
                    genre = ?10,
                    art_path = ?11,
                    recording_mbid = ?12,
                    release_mbid = ?13,
                    artist_mbids = ?14,
                    album_artist_mbids = ?15,
                    file_path = ?16,
                    sample_rate = ?17,
                    bitrate = ?18,
                    codec = ?19
                 WHERE id = ?20",
                params![
                    metadata.title,
                    metadata.artist,
                    metadata.album,
                    metadata.album_artist,
                    metadata.track_number,
                    metadata.total_tracks,
                    metadata.disc_number,
                    metadata.total_discs,
                    metadata.year,
                    metadata.genre,
                    metadata.art_path,
                    recording_mbid,
                    release_mbid,
                    artist_mbids,
                    album_artist_mbids,
                    path,
                    audio.sample_rate,
                    audio.bitrate,
                    audio.codec,
                    id,
                ],
            )?;
        } else {
            conn.execute(
                "UPDATE tracks SET
                    title = ?1,
                    artist = ?2,
                    album = ?3,
                    album_artist = ?4,
                    track_number = ?5,
                    total_tracks = ?6,
                    disc_number = ?7,
                    total_discs = ?8,
                    year = ?9,
                    genre = ?10,
                    art_path = ?11,
                    recording_mbid = ?12,
                    release_mbid = ?13,
                    artist_mbids = ?14,
                    album_artist_mbids = ?15,
                    file_path = ?16
                 WHERE id = ?17",
                params![
                    metadata.title,
                    metadata.artist,
                    metadata.album,
                    metadata.album_artist,
                    metadata.track_number,
                    metadata.total_tracks,
                    metadata.disc_number,
                    metadata.total_discs,
                    metadata.year,
                    metadata.genre,
                    metadata.art_path,
                    recording_mbid,
                    release_mbid,
                    artist_mbids,
                    album_artist_mbids,
                    path,
                    id,
                ],
            )?;
        }
    } else {
        conn.execute(
            "UPDATE tracks SET
                title = ?1,
                artist = ?2,
                album = ?3,
                album_artist = ?4,
                track_number = ?5,
                total_tracks = ?6,
                disc_number = ?7,
                total_discs = ?8,
                year = ?9,
                genre = ?10,
                art_path = ?11,
                recording_mbid = ?12,
                release_mbid = ?13,
                artist_mbids = ?14,
                album_artist_mbids = ?15
             WHERE id = ?16",
            params![
                metadata.title,
                metadata.artist,
                metadata.album,
                metadata.album_artist,
                metadata.track_number,
                metadata.total_tracks,
                metadata.disc_number,
                metadata.total_discs,
                metadata.year,
                metadata.genre,
                metadata.art_path,
                recording_mbid,
                release_mbid,
                artist_mbids,
                album_artist_mbids,
                id,
            ],
        )?;
    }
    Ok(())
}

pub fn get_track_by_id(conn: &Connection, id: i64) -> Result<Option<Track>, rusqlite::Error> {
    let sql = format!("{TRACK_SELECT} {TRACK_FROM_JOIN} WHERE tracks.id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(map_track_row(&row)?))
    } else {
        Ok(None)
    }
}

pub fn delete_track(conn: &Connection, id: i64) -> Result<bool, rusqlite::Error> {
    let deleted = conn.execute("DELETE FROM tracks WHERE id = ?1", params![id])?;
    Ok(deleted > 0)
}

fn playlist_track_ids(conn: &Connection, playlist_id: i64) -> Result<Vec<i64>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT track_id FROM playlist_tracks
         WHERE playlist_id = ?1
         ORDER BY position ASC",
    )?;
    let ids = stmt
        .query_map(params![playlist_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ids)
}

pub fn get_all_playlists(conn: &Connection) -> Result<Vec<Playlist>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, title, description, date_created, last_used_at, image_mode, custom_image_path
         FROM playlists
         ORDER BY position ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, Option<String>>(6)?,
        ))
    })?;

    let mut playlists = Vec::new();
    for row in rows {
        let (id, title, description, date_created, last_used_at, image_mode, custom_image_path) =
            row?;
        let track_ids = playlist_track_ids(conn, id)?;
        playlists.push(Playlist {
            id,
            title,
            description,
            date_created,
            last_used_at,
            track_ids,
            image_mode: parse_playlist_image_mode(&image_mode),
            custom_image_path,
        });
    }
    Ok(playlists)
}

pub fn create_playlist(
    conn: &Connection,
    title: &str,
    description: Option<&str>,
    image_mode: PlaylistImageMode,
    custom_image_path: Option<&str>,
) -> Result<i64, rusqlite::Error> {
    let now = Utc::now().to_rfc3339();
    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM playlists",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO playlists (title, description, date_created, last_used_at, image_mode, custom_image_path, position)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            title,
            description,
            now,
            now,
            playlist_image_mode_str(image_mode),
            custom_image_path,
            position,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_playlist(
    conn: &Connection,
    id: i64,
    title: &str,
    description: Option<&str>,
    image_mode: PlaylistImageMode,
    custom_image_path: Option<&str>,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE playlists SET title = ?1, description = ?2, image_mode = ?3, custom_image_path = ?4
         WHERE id = ?5",
        params![
            title,
            description,
            playlist_image_mode_str(image_mode),
            custom_image_path,
            id,
        ],
    )?;
    Ok(())
}

pub fn touch_playlist(conn: &Connection, id: i64) -> Result<(), rusqlite::Error> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE playlists SET last_used_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

pub fn delete_playlist(conn: &Connection, id: i64) -> Result<bool, rusqlite::Error> {
    let deleted = conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
    Ok(deleted > 0)
}

pub fn add_tracks_to_playlist(
    conn: &Connection,
    playlist_id: i64,
    track_ids: &[i64],
) -> Result<(), rusqlite::Error> {
    if track_ids.is_empty() {
        return Ok(());
    }

    let max_position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?1",
            params![playlist_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    let mut existing: std::collections::HashSet<i64> = conn
        .prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1")?
        .query_map(params![playlist_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .collect();

    let mut position = max_position + 1;
    for track_id in track_ids {
        if existing.contains(track_id) {
            continue;
        }
        conn.execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position)
             VALUES (?1, ?2, ?3)",
            params![playlist_id, track_id, position],
        )?;
        existing.insert(*track_id);
        position += 1;
    }

    touch_playlist(conn, playlist_id)?;
    Ok(())
}

pub fn remove_tracks_from_playlist(
    conn: &Connection,
    playlist_id: i64,
    track_ids: &[i64],
) -> Result<(), rusqlite::Error> {
    if track_ids.is_empty() {
        return Ok(());
    }

    for track_id in track_ids {
        conn.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
            params![playlist_id, track_id],
        )?;
    }

    touch_playlist(conn, playlist_id)?;
    Ok(())
}

pub fn reorder_playlist_tracks(
    conn: &Connection,
    playlist_id: i64,
    track_ids: &[i64],
) -> Result<(), rusqlite::Error> {
    let current = playlist_track_ids(conn, playlist_id)?;
    if current.len() != track_ids.len() {
        return Err(rusqlite::Error::InvalidParameterName(
            "track_ids length mismatch".into(),
        ));
    }
    let current_set: std::collections::HashSet<i64> = current.into_iter().collect();
    if !track_ids.iter().all(|id| current_set.contains(id)) {
        return Err(rusqlite::Error::InvalidParameterName(
            "track_ids contain unknown tracks".into(),
        ));
    }

    for (position, track_id) in track_ids.iter().enumerate() {
        conn.execute(
            "UPDATE playlist_tracks SET position = ?1
             WHERE playlist_id = ?2 AND track_id = ?3",
            params![position as i64, playlist_id, track_id],
        )?;
    }

    touch_playlist(conn, playlist_id)?;
    Ok(())
}

fn all_playlist_ids(conn: &Connection) -> Result<Vec<i64>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT id FROM playlists ORDER BY position ASC, id ASC")?;
    let ids = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ids)
}

pub fn reorder_playlists(conn: &Connection, playlist_ids: &[i64]) -> Result<(), rusqlite::Error> {
    let current = all_playlist_ids(conn)?;
    if current.len() != playlist_ids.len() {
        return Err(rusqlite::Error::InvalidParameterName(
            "playlist_ids length mismatch".into(),
        ));
    }
    let current_set: std::collections::HashSet<i64> = current.into_iter().collect();
    if !playlist_ids.iter().all(|id| current_set.contains(id)) {
        return Err(rusqlite::Error::InvalidParameterName(
            "playlist_ids contain unknown playlists".into(),
        ));
    }

    for (position, playlist_id) in playlist_ids.iter().enumerate() {
        conn.execute(
            "UPDATE playlists SET position = ?1 WHERE id = ?2",
            params![position as i64, playlist_id],
        )?;
    }

    Ok(())
}

pub fn list_file_paths(conn: &Connection) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT file_path FROM tracks")?;
    let paths = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(paths)
}

/// Persisted library size — used by the trial gate (not playlist membership).
pub fn count_tracks(conn: &Connection) -> Result<u32, rusqlite::Error> {
    conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| {
        let n: i64 = row.get(0)?;
        Ok(n as u32)
    })
}

pub fn track_exists_by_file_path(
    conn: &Connection,
    file_path: &str,
) -> Result<bool, rusqlite::Error> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tracks WHERE file_path = ?1",
        params![file_path],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

pub fn get_all_artist_images(conn: &Connection) -> Result<Vec<ArtistImage>, rusqlite::Error> {
    let mut stmt =
        conn.prepare("SELECT artist_key, art_path FROM artist_images ORDER BY artist_key")?;
    let images = stmt
        .query_map([], |row| {
            Ok(ArtistImage {
                artist_key: row.get(0)?,
                art_path: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(images)
}

pub fn save_artist_image(
    conn: &Connection,
    artist_key: &str,
    art_path: Option<&str>,
) -> Result<(), rusqlite::Error> {
    match art_path {
        Some(path) if !path.is_empty() => conn.execute(
            "INSERT INTO artist_images (artist_key, art_path)
             VALUES (?1, ?2)
             ON CONFLICT(artist_key) DO UPDATE SET art_path = excluded.art_path",
            params![artist_key, path],
        )?,
        _ => conn.execute(
            "DELETE FROM artist_images WHERE artist_key = ?1",
            params![artist_key],
        )?,
    };
    Ok(())
}

pub fn rename_artist_image_key(
    conn: &Connection,
    old_key: &str,
    new_key: &str,
) -> Result<(), rusqlite::Error> {
    let art_path: Option<String> = conn
        .query_row(
            "SELECT art_path FROM artist_images WHERE artist_key = ?1",
            params![old_key],
            |row| row.get(0),
        )
        .optional()?;

    let Some(art_path) = art_path else {
        return Ok(());
    };

    conn.execute(
        "DELETE FROM artist_images WHERE artist_key = ?1",
        params![old_key],
    )?;
    conn.execute(
        "INSERT INTO artist_images (artist_key, art_path)
         VALUES (?1, ?2)
         ON CONFLICT(artist_key) DO UPDATE SET art_path = excluded.art_path",
        params![new_key, art_path],
    )?;
    Ok(())
}

fn lyrics_format_to_str(format: LyricsFormat) -> &'static str {
    match format {
        LyricsFormat::Plain => "plain",
        LyricsFormat::LineSynced => "line_synced",
        LyricsFormat::WordSynced => "word_synced",
        LyricsFormat::Instrumental => "instrumental",
    }
}

fn parse_lyrics_format(value: &str) -> LyricsFormat {
    match value {
        "line_synced" => LyricsFormat::LineSynced,
        "word_synced" => LyricsFormat::WordSynced,
        "instrumental" => LyricsFormat::Instrumental,
        _ => LyricsFormat::Plain,
    }
}

fn lyrics_source_to_str(source: &LyricsSource) -> &'static str {
    match source {
        LyricsSource::Manual => "manual",
        LyricsSource::Embedded => "embedded",
        LyricsSource::Sidecar => "sidecar",
        LyricsSource::Lrclib => "lrclib",
    }
}

fn parse_lyrics_source(value: &str) -> Option<LyricsSource> {
    match value {
        "manual" => Some(LyricsSource::Manual),
        "embedded" => Some(LyricsSource::Embedded),
        "sidecar" => Some(LyricsSource::Sidecar),
        "lrclib" => Some(LyricsSource::Lrclib),
        _ => None,
    }
}

fn map_track_lyrics_row(row: &Row<'_>) -> rusqlite::Result<TrackLyricsRecord> {
    let track_id: i64 = row.get(0)?;
    let format = parse_lyrics_format(&row.get::<_, String>(1)?);
    let source = row
        .get::<_, Option<String>>(2)?
        .and_then(|value| parse_lyrics_source(&value));
    let lines_json: String = row.get(3)?;
    let lines: Vec<LyricsLine> = serde_json::from_str(&lines_json).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(err))
    })?;
    Ok(TrackLyricsRecord {
        track_id,
        format,
        source,
        lines,
        plain_text: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

pub fn get_track_lyrics(
    conn: &Connection,
    track_id: i64,
) -> Result<Option<TrackLyricsRecord>, rusqlite::Error> {
    conn.query_row(
        "SELECT track_id, format, source, lines_json, plain_text, updated_at
         FROM track_lyrics WHERE track_id = ?1",
        params![track_id],
        map_track_lyrics_row,
    )
    .optional()
}

pub fn upsert_track_lyrics(
    conn: &Connection,
    record: &TrackLyricsRecord,
) -> Result<(), rusqlite::Error> {
    let lines_json = serde_json::to_string(&record.lines)
        .map_err(|err| rusqlite::Error::ToSqlConversionFailure(Box::new(err)))?;
    let source = record.source.as_ref().map(lyrics_source_to_str);
    conn.execute(
        "INSERT INTO track_lyrics (track_id, format, source, lines_json, plain_text, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(track_id) DO UPDATE SET
            format = excluded.format,
            source = excluded.source,
            lines_json = excluded.lines_json,
            plain_text = excluded.plain_text,
            updated_at = excluded.updated_at",
        params![
            record.track_id,
            lyrics_format_to_str(record.format.clone()),
            source,
            lines_json,
            record.plain_text,
            record.updated_at,
        ],
    )?;
    Ok(())
}

pub fn delete_track_lyrics(conn: &Connection, track_id: i64) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM track_lyrics WHERE track_id = ?1",
        params![track_id],
    )?;
    Ok(())
}

/// Batch load lyrics for multiple tracks (library hydration — Phase 2).
#[allow(dead_code)]
pub fn get_lyrics_for_track_ids(
    conn: &Connection,
    ids: &[i64],
) -> Result<HashMap<i64, TrackLyricsRecord>, rusqlite::Error> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders = (0..ids.len()).map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT track_id, format, source, lines_json, plain_text, updated_at
         FROM track_lyrics WHERE track_id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), map_track_lyrics_row)?;
    let mut lyrics = HashMap::new();
    for row in rows {
        let record = row?;
        lyrics.insert(record.track_id, record);
    }
    Ok(lyrics)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{LyricsFormat, LyricsLine, LyricsSource, TrackInput, TrackMetadataUpdate};

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn sample_input(path: &str) -> TrackInput {
        TrackInput {
            title: "Song".into(),
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            total_tracks: None,
            disc_number: None,
            total_discs: None,
            year: None,
            genre: None,
            duration_seconds: None,
            sample_rate: None,
            bitrate: None,
            codec: None,
            file_path: path.into(),
            art_path: None,
            rating: None,
            lyrics: None,
            ..Default::default()
        }
    }

    fn sample_listen(track_id: i64, completion: &str) -> ListenEventInput {
        ListenEventInput {
            track_id,
            started_at: "2026-07-13T12:00:00Z".into(),
            ended_at: "2026-07-13T12:01:00Z".into(),
            listened_seconds: 60.0,
            library_listened_seconds: 60.0,
            skin_listened_seconds: 0.0,
            track_duration_seconds: Some(180.0),
            completion: completion.into(),
            source: "library".into(),
            ui_mode: "library".into(),
            theme_id: None,
            theme_name: None,
            skin_id: None,
            skin_name: None,
            visualizer_id: None,
            visualizer_name: None,
        }
    }

    fn listen_event_count(conn: &Connection, track_id: i64) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM listen_events WHERE track_id = ?1",
            params![track_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn save_track_preserves_date_added_on_reimport() {
        let conn = test_conn();
        let path = "/music/song.mp3";

        save_track(&conn, &sample_input(path)).unwrap();
        let first = get_track_by_id(&conn, 1).unwrap().unwrap();
        let first_added = first.date_added.clone();

        std::thread::sleep(std::time::Duration::from_millis(5));

        let mut updated = sample_input(path);
        updated.title = "Renamed".into();
        save_track(&conn, &updated).unwrap();

        let second = get_track_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(second.title, "Renamed");
        assert_eq!(second.date_added, first_added);
    }

    #[test]
    fn reorder_playlist_tracks_updates_order() {
        let conn = test_conn();
        save_track(&conn, &sample_input("/music/a.mp3")).unwrap();
        save_track(&conn, &sample_input("/music/b.mp3")).unwrap();
        save_track(&conn, &sample_input("/music/c.mp3")).unwrap();

        let playlist_id =
            create_playlist(&conn, "Mix", None, PlaylistImageMode::Generated, None).unwrap();
        add_tracks_to_playlist(&conn, playlist_id, &[1, 2, 3]).unwrap();
        assert_eq!(
            playlist_track_ids(&conn, playlist_id).unwrap(),
            vec![1, 2, 3]
        );

        reorder_playlist_tracks(&conn, playlist_id, &[3, 1, 2]).unwrap();
        assert_eq!(
            playlist_track_ids(&conn, playlist_id).unwrap(),
            vec![3, 1, 2]
        );
    }

    #[test]
    fn reorder_playlists_updates_sidebar_order() {
        let conn = test_conn();
        let zebra =
            create_playlist(&conn, "Zebra", None, PlaylistImageMode::Generated, None).unwrap();
        let alpha =
            create_playlist(&conn, "Alpha", None, PlaylistImageMode::Generated, None).unwrap();
        let middle =
            create_playlist(&conn, "Middle", None, PlaylistImageMode::Generated, None).unwrap();

        assert_eq!(
            get_all_playlists(&conn)
                .unwrap()
                .into_iter()
                .map(|p| p.id)
                .collect::<Vec<_>>(),
            vec![zebra, alpha, middle]
        );

        reorder_playlists(&conn, &[alpha, middle, zebra]).unwrap();
        assert_eq!(
            get_all_playlists(&conn)
                .unwrap()
                .into_iter()
                .map(|p| p.id)
                .collect::<Vec<_>>(),
            vec![alpha, middle, zebra]
        );
    }

    #[test]
    fn record_listen_event_inserts_and_updates_counters() {
        let mut conn = test_conn();
        save_track(&conn, &sample_input("/music/a.mp3")).unwrap();

        let mut event = sample_listen(1, "natural_end");
        event.ended_at = "2026-07-13T12:03:00Z".into();
        event.listened_seconds = 180.0;
        event.library_listened_seconds = 40.0;
        event.skin_listened_seconds = 140.0;
        event.ui_mode = "skin".into();
        event.theme_id = Some("obsidian".into());
        event.theme_name = Some("Obsidian".into());
        event.skin_id = Some("vanilla".into());
        event.skin_name = Some("Spiral Default".into());
        event.visualizer_id = Some("bars".into());
        event.visualizer_name = Some("Bars".into());

        let result = record_listen_event(&mut conn, &event).unwrap();

        assert_eq!(result.event_id, 1);
        assert_eq!(result.play_count, 1);
        assert!(result.counted);
        assert!(result.recorded);
        assert_eq!(result.last_played_at, "2026-07-13T12:03:00Z");

        let track = get_track_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(track.play_count, 1);
        assert_eq!(
            track.last_played_at.as_deref(),
            Some("2026-07-13T12:03:00Z")
        );

        assert_eq!(listen_event_count(&conn, 1), 1);

        let (completion, theme_id, theme_name, skin_name, ui_mode, lib_s, skin_s): (
            String,
            String,
            String,
            String,
            String,
            f64,
            f64,
        ) = conn
            .query_row(
                "SELECT completion, theme_id, theme_name, skin_name, ui_mode,
                        library_listened_seconds, skin_listened_seconds
                 FROM listen_events WHERE id = 1",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(completion, "natural_end");
        assert_eq!(theme_id, "obsidian");
        assert_eq!(theme_name, "Obsidian");
        assert_eq!(skin_name, "Spiral Default");
        assert_eq!(ui_mode, "skin");
        assert_eq!(lib_s, 40.0);
        assert_eq!(skin_s, 140.0);
    }

    #[test]
    fn record_listen_event_short_skip_does_not_count() {
        let mut conn = test_conn();
        save_track(&conn, &sample_input("/music/a.mp3")).unwrap();

        let mut event = sample_listen(1, "skipped");
        event.ended_at = "2026-07-13T12:00:10Z".into();
        event.listened_seconds = 10.0;
        event.track_duration_seconds = Some(180.0);

        let result = record_listen_event(&mut conn, &event).unwrap();

        assert!(result.recorded);
        assert!(!result.counted);
        assert_eq!(result.play_count, 0);
        assert_eq!(result.last_played_at, "");
        assert_eq!(listen_event_count(&conn, 1), 1);

        let last_played_at: Option<String> = conn
            .query_row(
                "SELECT last_played_at FROM tracks WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(last_played_at.is_none());
    }

    #[test]
    fn listen_event_qualifies_at_threshold_boundaries() {
        let mut base = sample_listen(1, "skipped");
        base.track_duration_seconds = Some(100.0);

        let mut under_seconds = base.clone();
        under_seconds.listened_seconds = 29.9;
        assert!(!listen_event_qualifies(&under_seconds));

        let mut at_seconds = base.clone();
        at_seconds.listened_seconds = 30.0;
        assert!(listen_event_qualifies(&at_seconds));

        // Under 30s and under 50% of duration.
        let mut under_ratio = base.clone();
        under_ratio.listened_seconds = 14.0;
        under_ratio.track_duration_seconds = Some(40.0);
        assert!(!listen_event_qualifies(&under_ratio));

        let mut at_ratio = base.clone();
        at_ratio.listened_seconds = 20.0;
        at_ratio.track_duration_seconds = Some(40.0);
        assert!(listen_event_qualifies(&at_ratio));

        let mut natural = base.clone();
        natural.completion = "natural_end".into();
        natural.listened_seconds = 1.0;
        natural.track_duration_seconds = Some(300.0);
        assert!(listen_event_qualifies(&natural));
    }

    #[test]
    fn skip_listen_event_recording_leaves_history_untouched() {
        let mut conn = test_conn();
        save_track(&conn, &sample_input("/music/a.mp3")).unwrap();
        record_listen_event(&mut conn, &sample_listen(1, "natural_end")).unwrap();

        let result = skip_listen_event_recording(&conn, 1).unwrap();
        assert!(!result.recorded);
        assert!(!result.counted);
        assert_eq!(result.event_id, 0);
        assert_eq!(result.play_count, 1);
        assert_eq!(listen_event_count(&conn, 1), 1);
    }

    #[test]
    fn clear_listen_events_all_resets_counters() {
        let mut conn = test_conn();
        save_track(&conn, &sample_input("/music/a.mp3")).unwrap();
        save_track(&conn, &sample_input("/music/b.mp3")).unwrap();
        record_listen_event(&mut conn, &sample_listen(1, "natural_end")).unwrap();
        record_listen_event(&mut conn, &sample_listen(2, "natural_end")).unwrap();

        let cleared = clear_listen_events(&conn, None).unwrap();
        assert_eq!(cleared.deleted_events, 2);
        assert!(cleared.reset_counters);
        assert_eq!(listen_event_count(&conn, 1), 0);
        assert_eq!(get_track_by_id(&conn, 1).unwrap().unwrap().play_count, 0);
        let last_played_at: Option<String> = conn
            .query_row(
                "SELECT last_played_at FROM tracks WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(last_played_at.is_none());
    }

    #[test]
    fn clear_listen_events_within_hours_keeps_older_rows() {
        let mut conn = test_conn();
        save_track(&conn, &sample_input("/music/a.mp3")).unwrap();

        let mut old = sample_listen(1, "natural_end");
        old.ended_at = "2020-01-01T00:00:00.000Z".into();
        record_listen_event(&mut conn, &old).unwrap();

        let mut recent = sample_listen(1, "natural_end");
        recent.ended_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        record_listen_event(&mut conn, &recent).unwrap();

        assert_eq!(listen_event_count(&conn, 1), 2);
        let cleared = clear_listen_events(&conn, Some(24)).unwrap();
        assert_eq!(cleared.deleted_events, 1);
        assert!(!cleared.reset_counters);
        assert_eq!(listen_event_count(&conn, 1), 1);
        assert_eq!(get_track_by_id(&conn, 1).unwrap().unwrap().play_count, 2);

        let ended_at: String = conn
            .query_row(
                "SELECT ended_at FROM listen_events WHERE track_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ended_at, "2020-01-01T00:00:00.000Z");
    }

    #[test]
    fn delete_track_cascades_listen_events() {
        let mut conn = test_conn();
        save_track(&conn, &sample_input("/music/a.mp3")).unwrap();
        record_listen_event(&mut conn, &sample_listen(1, "natural_end")).unwrap();

        assert_eq!(listen_event_count(&conn, 1), 1);
        delete_track(&conn, 1).unwrap();
        assert_eq!(listen_event_count(&conn, 1), 0);
    }

    #[test]
    fn set_track_rating_persists_and_preserves_on_upsert() {
        let conn = test_conn();
        let path = "/music/rated.mp3";

        save_track(&conn, &sample_input(path)).unwrap();
        assert_eq!(set_track_rating(&conn, 1, 128).unwrap(), 128);

        let rated = get_track_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(rated.rating, 128);

        let mut updated = sample_input(path);
        updated.title = "Renamed".into();
        save_track(&conn, &updated).unwrap();

        let after_upsert = get_track_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(after_upsert.title, "Renamed");
        assert_eq!(after_upsert.rating, 128);
    }

    #[test]
    fn save_track_seeds_rating_on_first_import() {
        let conn = test_conn();
        let path = "/music/new-rated.mp3";

        let mut input = sample_input(path);
        input.rating = Some(204);
        save_track(&conn, &input).unwrap();

        let track = get_track_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(track.rating, 204);
    }

    #[test]
    fn save_track_seeds_rating_on_reimport_when_unrated() {
        let conn = test_conn();
        let path = "/music/late-rated.mp3";

        save_track(&conn, &sample_input(path)).unwrap();
        assert_eq!(get_track_by_id(&conn, 1).unwrap().unwrap().rating, 0);

        let mut updated = sample_input(path);
        updated.rating = Some(153);
        save_track(&conn, &updated).unwrap();

        assert_eq!(get_track_by_id(&conn, 1).unwrap().unwrap().rating, 153);
    }

    #[test]
    fn save_track_does_not_overwrite_existing_rating_on_reimport() {
        let conn = test_conn();
        let path = "/music/keep-rating.mp3";

        let mut first = sample_input(path);
        first.rating = Some(128);
        save_track(&conn, &first).unwrap();
        set_track_rating(&conn, 1, 179).unwrap();

        let mut updated = sample_input(path);
        updated.rating = Some(255);
        save_track(&conn, &updated).unwrap();

        assert_eq!(get_track_by_id(&conn, 1).unwrap().unwrap().rating, 179);
    }

    #[test]
    fn save_track_refresh_preserves_library_fields() {
        let mut conn = test_conn();
        let path = "/music/refresh.mp3";

        save_track(&conn, &sample_input(path)).unwrap();
        record_listen_event(&mut conn, &sample_listen(1, "natural_end")).unwrap();
        record_listen_event(&mut conn, &sample_listen(1, "natural_end")).unwrap();
        set_track_rating(&conn, 1, 128).unwrap();

        let before = get_track_by_id(&conn, 1).unwrap().unwrap();
        let date_added = before.date_added.clone();
        assert_eq!(before.play_count, 2);
        assert_eq!(before.rating, 128);

        std::thread::sleep(std::time::Duration::from_millis(5));

        let mut refreshed = sample_input(path);
        refreshed.title = "Updated Title".into();
        refreshed.artist = Some("Updated Artist".into());
        refreshed.album = Some("Updated Album".into());
        refreshed.duration_seconds = Some(245.0);
        refreshed.sample_rate = Some(48_000);
        refreshed.bitrate = Some(320);
        refreshed.codec = Some("mp3".into());
        refreshed.rating = Some(255);
        save_track(&conn, &refreshed).unwrap();

        let after = get_track_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(after.title, "Updated Title");
        assert_eq!(after.artist.as_deref(), Some("Updated Artist"));
        assert_eq!(after.album.as_deref(), Some("Updated Album"));
        assert_eq!(after.duration_seconds, Some(245.0));
        assert_eq!(after.sample_rate, Some(48_000));
        assert_eq!(after.bitrate, Some(320));
        assert_eq!(after.codec.as_deref(), Some("mp3"));
        assert_eq!(after.date_added, date_added);
        assert_eq!(after.play_count, 2);
        assert_eq!(after.last_played_at, before.last_played_at);
        assert_eq!(after.rating, 128);
    }

    const SAMPLE_RECORDING_MBID: &str = "550e8400-e29b-41d4-a716-446655440000";
    const SAMPLE_RELEASE_MBID: &str = "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b";
    const SAMPLE_ARTIST_MBID: &str = "a74b1b3a-d5ba-4d8a-b656-e59347b6780e";
    const SAMPLE_ALBUM_ARTIST_MBID: &str = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d";

    fn sample_mbid_input(path: &str) -> TrackInput {
        let mut input = sample_input(path);
        input.recording_mbid = Some("550E8400-E29B-41D4-A716-446655440000".into());
        input.release_mbid = Some(SAMPLE_RELEASE_MBID.into());
        input.artist_mbids = vec![SAMPLE_ARTIST_MBID.to_uppercase(), "  ".into()];
        input.album_artist_mbids = vec![SAMPLE_ALBUM_ARTIST_MBID.into()];
        input
    }

    #[test]
    fn migrate_adds_mbid_columns_to_existing_tracks_table() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE tracks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT NOT NULL,
              artist TEXT,
              album TEXT,
              album_artist TEXT,
              track_number INTEGER,
              total_tracks INTEGER,
              disc_number INTEGER,
              total_discs INTEGER,
              year INTEGER,
              genre TEXT,
              duration_seconds REAL,
              sample_rate INTEGER,
              bitrate INTEGER,
              codec TEXT,
              file_path TEXT NOT NULL UNIQUE,
              art_path TEXT,
              date_added TEXT NOT NULL,
              play_count INTEGER NOT NULL DEFAULT 0,
              last_played_at TEXT,
              rating INTEGER NOT NULL DEFAULT 0
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks (title, file_path, date_added)
             VALUES ('Legacy', '/music/legacy.mp3', '2020-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

        conn.execute_batch(SCHEMA).unwrap();
        migrate(&conn).unwrap();

        let columns = table_columns(&conn, "tracks").unwrap();
        for name in [
            "recording_mbid",
            "release_mbid",
            "artist_mbids",
            "album_artist_mbids",
        ] {
            assert!(
                columns.iter().any(|c| c == name),
                "missing migrated column {name}"
            );
        }

        let track = get_track_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(track.title, "Legacy");
        assert_eq!(track.recording_mbid, None);
        assert_eq!(track.release_mbid, None);
        assert!(track.artist_mbids.is_empty());
        assert!(track.album_artist_mbids.is_empty());
    }

    #[test]
    fn save_track_round_trips_mbids() {
        let conn = test_conn();
        let id = save_track(&conn, &sample_mbid_input("/music/mbid.mp3")).unwrap();
        let track = get_track_by_id(&conn, id).unwrap().unwrap();

        assert_eq!(track.recording_mbid.as_deref(), Some(SAMPLE_RECORDING_MBID));
        assert_eq!(track.release_mbid.as_deref(), Some(SAMPLE_RELEASE_MBID));
        assert_eq!(track.artist_mbids, vec![SAMPLE_ARTIST_MBID.to_string()]);
        assert_eq!(
            track.album_artist_mbids,
            vec![SAMPLE_ALBUM_ARTIST_MBID.to_string()]
        );

        let artist_sql: Option<String> = conn
            .query_row(
                "SELECT artist_mbids FROM tracks WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            artist_sql.as_deref(),
            Some(r#"["a74b1b3a-d5ba-4d8a-b656-e59347b6780e"]"#)
        );
    }

    #[test]
    fn save_track_stores_empty_artist_mbids_as_null() {
        let conn = test_conn();
        let id = save_track(&conn, &sample_input("/music/no-mbid.mp3")).unwrap();
        let artist_sql: Option<String> = conn
            .query_row(
                "SELECT artist_mbids FROM tracks WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        let album_artist_sql: Option<String> = conn
            .query_row(
                "SELECT album_artist_mbids FROM tracks WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(artist_sql, None);
        assert_eq!(album_artist_sql, None);
    }

    #[test]
    fn save_track_on_conflict_updates_mbid_columns() {
        let conn = test_conn();
        let path = "/music/conflict-mbid.mp3";
        save_track(&conn, &sample_mbid_input(path)).unwrap();

        let mut updated = sample_input(path);
        updated.title = "Retagged".into();
        updated.recording_mbid = Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".into());
        updated.release_mbid = None;
        updated.artist_mbids = vec![];
        updated.album_artist_mbids = vec!["CCCCCCCC-DDDD-EEEE-FFFF-000000000000".into()];
        save_track(&conn, &updated).unwrap();

        let track = get_track_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(track.title, "Retagged");
        assert_eq!(
            track.recording_mbid.as_deref(),
            Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
        );
        assert_eq!(track.release_mbid, None);
        assert!(track.artist_mbids.is_empty());
        assert_eq!(
            track.album_artist_mbids,
            vec!["cccccccc-dddd-eeee-ffff-000000000000".to_string()]
        );

        let artist_sql: Option<String> = conn
            .query_row("SELECT artist_mbids FROM tracks WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(artist_sql, None);
    }

    #[test]
    fn update_track_writes_mbids() {
        let conn = test_conn();
        let id = save_track(&conn, &sample_input("/music/update-mbid.mp3")).unwrap();
        let existing = get_track_by_id(&conn, id).unwrap().unwrap();

        update_track(
            &conn,
            id,
            &TrackMetadataUpdate {
                title: existing.title.clone(),
                artist: existing.artist.clone(),
                album: existing.album.clone(),
                album_artist: existing.album_artist.clone(),
                track_number: existing.track_number,
                total_tracks: existing.total_tracks,
                disc_number: existing.disc_number,
                total_discs: existing.total_discs,
                year: existing.year,
                genre: existing.genre.clone(),
                art_path: existing.art_path.clone(),
                art_changed: false,
                lyrics: None,
                lyrics_changed: false,
                recording_mbid: Some(SAMPLE_RECORDING_MBID.into()),
                release_mbid: Some(SAMPLE_RELEASE_MBID.into()),
                artist_mbids: vec![SAMPLE_ARTIST_MBID.into()],
                album_artist_mbids: vec![SAMPLE_ALBUM_ARTIST_MBID.into()],
            },
            None,
            None,
        )
        .unwrap();

        let track = get_track_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(track.recording_mbid.as_deref(), Some(SAMPLE_RECORDING_MBID));
        assert_eq!(track.release_mbid.as_deref(), Some(SAMPLE_RELEASE_MBID));
        assert_eq!(track.artist_mbids, vec![SAMPLE_ARTIST_MBID.to_string()]);
        assert_eq!(
            track.album_artist_mbids,
            vec![SAMPLE_ALBUM_ARTIST_MBID.to_string()]
        );
    }

    #[test]
    fn convert_replace_updates_path_preserving_id() {
        let conn = test_conn();
        let id = save_track(&conn, &sample_input("/music/album/track.flac")).unwrap();
        let existing = get_track_by_id(&conn, id).unwrap().unwrap();

        update_track(
            &conn,
            id,
            &TrackMetadataUpdate {
                title: existing.title.clone(),
                artist: existing.artist.clone(),
                album: existing.album.clone(),
                album_artist: existing.album_artist.clone(),
                track_number: existing.track_number,
                total_tracks: existing.total_tracks,
                disc_number: existing.disc_number,
                total_discs: existing.total_discs,
                year: existing.year,
                genre: existing.genre.clone(),
                art_path: existing.art_path.clone(),
                art_changed: false,
                lyrics: None,
                lyrics_changed: false,
                recording_mbid: existing.recording_mbid.clone(),
                release_mbid: existing.release_mbid.clone(),
                artist_mbids: existing.artist_mbids.clone(),
                album_artist_mbids: existing.album_artist_mbids.clone(),
            },
            Some("/music/album/track.m4a"),
            None,
        )
        .unwrap();

        let updated = get_track_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(updated.id, id);
        assert_eq!(updated.file_path, "/music/album/track.m4a");
    }

    #[test]
    fn convert_add_new_creates_row_with_distinct_file_path() {
        let conn = test_conn();
        save_track(&conn, &sample_input("/music/album/track.flac")).unwrap();
        save_track(&conn, &sample_input("/music/album/track.m4a")).unwrap();

        let tracks = get_all_tracks(&conn).unwrap();
        assert_eq!(tracks.len(), 2);
        assert_ne!(tracks[0].file_path, tracks[1].file_path);
    }

    fn sample_lyrics(track_id: i64, plain_text: &str) -> TrackLyricsRecord {
        TrackLyricsRecord {
            track_id,
            format: LyricsFormat::Plain,
            source: Some(LyricsSource::Manual),
            lines: plain_text
                .lines()
                .map(|line| LyricsLine {
                    text: line.to_string(),
                    start_ms: None,
                    end_ms: None,
                    words: None,
                })
                .collect(),
            plain_text: plain_text.to_string(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn track_lyrics_round_trip() {
        let conn = test_conn();
        save_track(&conn, &sample_input("/music/lyrics.mp3")).unwrap();

        let record = sample_lyrics(1, "Line one\nLine two");
        upsert_track_lyrics(&conn, &record).unwrap();

        let loaded = get_track_lyrics(&conn, 1).unwrap().unwrap();
        assert_eq!(loaded.track_id, 1);
        assert_eq!(loaded.format, LyricsFormat::Plain);
        assert_eq!(loaded.source, Some(LyricsSource::Manual));
        assert_eq!(loaded.plain_text, "Line one\nLine two");
        assert_eq!(loaded.lines.len(), 2);
        assert_eq!(loaded.lines[0].text, "Line one");
        assert_eq!(loaded.lines[1].text, "Line two");
    }

    #[test]
    fn track_lyrics_instrumental_round_trip_and_track_format() {
        let conn = test_conn();
        save_track(&conn, &sample_input("/music/instrumental.mp3")).unwrap();

        let record = TrackLyricsRecord {
            track_id: 1,
            format: LyricsFormat::Instrumental,
            source: Some(LyricsSource::Lrclib),
            lines: vec![],
            plain_text: String::new(),
            updated_at: Utc::now().to_rfc3339(),
        };
        upsert_track_lyrics(&conn, &record).unwrap();

        let loaded = get_track_lyrics(&conn, 1).unwrap().unwrap();
        assert_eq!(loaded.format, LyricsFormat::Instrumental);
        assert_eq!(loaded.source, Some(LyricsSource::Lrclib));
        assert!(loaded.plain_text.is_empty());

        let track = get_track_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(track.lyrics_format, Some(LyricsFormat::Instrumental));
    }

    #[test]
    fn track_lyrics_upsert_replaces_existing() {
        let conn = test_conn();
        save_track(&conn, &sample_input("/music/lyrics.mp3")).unwrap();

        upsert_track_lyrics(&conn, &sample_lyrics(1, "First version")).unwrap();
        upsert_track_lyrics(&conn, &sample_lyrics(1, "Second version")).unwrap();

        let loaded = get_track_lyrics(&conn, 1).unwrap().unwrap();
        assert_eq!(loaded.plain_text, "Second version");
    }

    #[test]
    fn delete_track_lyrics_removes_row() {
        let conn = test_conn();
        save_track(&conn, &sample_input("/music/lyrics.mp3")).unwrap();
        upsert_track_lyrics(&conn, &sample_lyrics(1, "To delete")).unwrap();

        delete_track_lyrics(&conn, 1).unwrap();
        assert!(get_track_lyrics(&conn, 1).unwrap().is_none());
    }

    #[test]
    fn get_lyrics_for_track_ids_returns_batch_map() {
        let conn = test_conn();
        save_track(&conn, &sample_input("/music/a.mp3")).unwrap();
        save_track(&conn, &sample_input("/music/b.mp3")).unwrap();
        save_track(&conn, &sample_input("/music/c.mp3")).unwrap();

        upsert_track_lyrics(&conn, &sample_lyrics(1, "Track A")).unwrap();
        upsert_track_lyrics(&conn, &sample_lyrics(3, "Track C")).unwrap();

        let lyrics = get_lyrics_for_track_ids(&conn, &[1, 2, 3]).unwrap();
        assert_eq!(lyrics.len(), 2);
        assert_eq!(lyrics.get(&1).unwrap().plain_text, "Track A");
        assert_eq!(lyrics.get(&3).unwrap().plain_text, "Track C");
        assert!(!lyrics.contains_key(&2));
    }

    #[test]
    fn delete_track_cascades_lyrics() {
        let conn = test_conn();
        save_track(&conn, &sample_input("/music/lyrics.mp3")).unwrap();
        upsert_track_lyrics(&conn, &sample_lyrics(1, "Cascade me")).unwrap();

        conn.execute("DELETE FROM tracks WHERE id = 1", []).unwrap();
        assert!(get_track_lyrics(&conn, 1).unwrap().is_none());
    }

    #[test]
    fn persist_import_lyrics_upserts_when_present() {
        use crate::lyrics_normalize::{normalize_embedded_lyrics, persist_import_lyrics};
        use crate::lyrics_tags::{LyricsFormatHint, RawLyrics};

        let conn = test_conn();
        save_track(&conn, &sample_input("/music/song.mp3")).unwrap();

        let input = normalize_embedded_lyrics(RawLyrics {
            text: "Embedded verse".to_string(),
            hint: LyricsFormatHint::Plain,
        });
        persist_import_lyrics(&conn, 1, &Some(input)).unwrap();

        let loaded = get_track_lyrics(&conn, 1).unwrap().unwrap();
        assert_eq!(loaded.plain_text, "Embedded verse");
        assert_eq!(loaded.source, Some(LyricsSource::Embedded));
    }

    #[test]
    fn persist_import_lyrics_skips_when_absent() {
        use crate::lyrics_normalize::persist_import_lyrics;

        let conn = test_conn();
        save_track(&conn, &sample_input("/music/song.mp3")).unwrap();
        upsert_track_lyrics(&conn, &sample_lyrics(1, "Existing")).unwrap();

        persist_import_lyrics(&conn, 1, &None).unwrap();

        let loaded = get_track_lyrics(&conn, 1).unwrap().unwrap();
        assert_eq!(loaded.plain_text, "Existing");
    }

    #[test]
    fn get_track_by_id_includes_lyrics_format_when_present() {
        let conn = test_conn();
        save_track(&conn, &sample_input("/music/song.mp3")).unwrap();

        let without_lyrics = get_track_by_id(&conn, 1).unwrap().unwrap();
        assert!(without_lyrics.lyrics_format.is_none());

        upsert_track_lyrics(&conn, &sample_lyrics(1, "Line one")).unwrap();

        let with_plain = get_track_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(with_plain.lyrics_format, Some(LyricsFormat::Plain));
    }
}
