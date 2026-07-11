use crate::audio_properties::AudioProperties;
use crate::models::{
    ArtistImage, LyricsFormat, LyricsLine, LyricsSource, Playlist, PlaylistImageMode, Track,
    TrackInput, TrackLyricsRecord, TrackMetadataUpdate,
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
  disc_number INTEGER,
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
  rating INTEGER NOT NULL DEFAULT 0
);

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
  artist_key TEXT NOT NULL,
  browse_mode TEXT NOT NULL,
  art_path TEXT NOT NULL,
  PRIMARY KEY (artist_key, browse_mode)
);

CREATE TABLE IF NOT EXISTS track_lyrics (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  format TEXT NOT NULL DEFAULT 'plain',
  source TEXT,
  lines_json TEXT NOT NULL,
  plain_text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
";

const TRACK_SELECT: &str = "SELECT tracks.id, tracks.title, tracks.artist, tracks.album, tracks.album_artist, tracks.track_number, tracks.disc_number,
                tracks.year, tracks.genre, tracks.duration_seconds, tracks.sample_rate, tracks.bitrate, tracks.codec, tracks.file_path, tracks.art_path,
                tracks.date_added, tracks.play_count, tracks.rating, track_lyrics.format";

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
        disc_number: row.get(6)?,
        year: row.get(7)?,
        genre: row.get(8)?,
        duration_seconds: row.get(9)?,
        sample_rate: row.get(10)?,
        bitrate: row.get(11)?,
        codec: row.get(12)?,
        file_path: row.get(13)?,
        art_path: row.get(14)?,
        date_added: row.get(15)?,
        play_count: row.get(16)?,
        rating: row.get(17)?,
        lyrics_format: row
            .get::<_, Option<String>>(18)?
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
            let mut stmt = conn.prepare(
                "SELECT id FROM playlists ORDER BY title COLLATE NOCASE, id ASC",
            )?;
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

    Ok(())
}

pub fn open(db_path: &Path) -> Result<Connection, rusqlite::Error> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let conn = Connection::open(db_path)?;
    conn.execute_batch(SCHEMA)?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn save_track(conn: &Connection, input: &TrackInput) -> Result<i64, rusqlite::Error> {
    let date_added = Utc::now().to_rfc3339();
    let rating = input.rating.unwrap_or(0);
    conn.execute(
        "INSERT INTO tracks (
            title, artist, album, album_artist, track_number, disc_number,
            year, genre, duration_seconds, sample_rate, bitrate, codec,
            file_path, art_path, date_added, rating
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
        ON CONFLICT(file_path) DO UPDATE SET
            title = excluded.title,
            artist = excluded.artist,
            album = excluded.album,
            album_artist = excluded.album_artist,
            track_number = excluded.track_number,
            disc_number = excluded.disc_number,
            year = excluded.year,
            genre = excluded.genre,
            duration_seconds = excluded.duration_seconds,
            sample_rate = excluded.sample_rate,
            bitrate = excluded.bitrate,
            codec = excluded.codec,
            art_path = excluded.art_path,
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
            input.disc_number,
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
        ],
    )?;

    let id = conn.query_row(
        "SELECT id FROM tracks WHERE file_path = ?1",
        params![input.file_path],
        |row| row.get(0),
    )?;
    Ok(id)
}

pub fn increment_play_count(conn: &Connection, id: i64) -> Result<u32, rusqlite::Error> {
    conn.execute(
        "UPDATE tracks SET play_count = play_count + 1 WHERE id = ?1",
        params![id],
    )?;
    conn.query_row(
        "SELECT play_count FROM tracks WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )
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
    if let Some(path) = file_path {
        if let Some(audio) = audio_properties {
            conn.execute(
                "UPDATE tracks SET
                    title = ?1,
                    artist = ?2,
                    album = ?3,
                    album_artist = ?4,
                    track_number = ?5,
                    disc_number = ?6,
                    year = ?7,
                    genre = ?8,
                    art_path = ?9,
                    file_path = ?10,
                    sample_rate = ?11,
                    bitrate = ?12,
                    codec = ?13
                 WHERE id = ?14",
                params![
                    metadata.title,
                    metadata.artist,
                    metadata.album,
                    metadata.album_artist,
                    metadata.track_number,
                    metadata.disc_number,
                    metadata.year,
                    metadata.genre,
                    metadata.art_path,
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
                    disc_number = ?6,
                    year = ?7,
                    genre = ?8,
                    art_path = ?9,
                    file_path = ?10
                 WHERE id = ?11",
                params![
                    metadata.title,
                    metadata.artist,
                    metadata.album,
                    metadata.album_artist,
                    metadata.track_number,
                    metadata.disc_number,
                    metadata.year,
                    metadata.genre,
                    metadata.art_path,
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
                disc_number = ?6,
                year = ?7,
                genre = ?8,
                art_path = ?9
             WHERE id = ?10",
            params![
                metadata.title,
                metadata.artist,
                metadata.album,
                metadata.album_artist,
                metadata.track_number,
                metadata.disc_number,
                metadata.year,
                metadata.genre,
                metadata.art_path,
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
        let (
            id,
            title,
            description,
            date_created,
            last_used_at,
            image_mode,
            custom_image_path,
        ) = row?;
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

pub fn reorder_playlists(
    conn: &Connection,
    playlist_ids: &[i64],
) -> Result<(), rusqlite::Error> {
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

pub fn get_all_artist_images(conn: &Connection) -> Result<Vec<ArtistImage>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT artist_key, browse_mode, art_path FROM artist_images ORDER BY artist_key",
    )?;
    let images = stmt
        .query_map([], |row| {
            Ok(ArtistImage {
                artist_key: row.get(0)?,
                browse_mode: row.get(1)?,
                art_path: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(images)
}

pub fn save_artist_image(
    conn: &Connection,
    artist_key: &str,
    browse_mode: &str,
    art_path: Option<&str>,
) -> Result<(), rusqlite::Error> {
    match art_path {
        Some(path) if !path.is_empty() => conn.execute(
            "INSERT INTO artist_images (artist_key, browse_mode, art_path)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(artist_key, browse_mode) DO UPDATE SET art_path = excluded.art_path",
            params![artist_key, browse_mode, path],
        )?,
        _ => conn.execute(
            "DELETE FROM artist_images WHERE artist_key = ?1 AND browse_mode = ?2",
            params![artist_key, browse_mode],
        )?,
    };
    Ok(())
}

pub fn rename_artist_image_key(
    conn: &Connection,
    old_key: &str,
    new_key: &str,
    browse_mode: &str,
) -> Result<(), rusqlite::Error> {
    let art_path: Option<String> = conn
        .query_row(
            "SELECT art_path FROM artist_images WHERE artist_key = ?1 AND browse_mode = ?2",
            params![old_key, browse_mode],
            |row| row.get(0),
        )
        .optional()?;

    let Some(art_path) = art_path else {
        return Ok(());
    };

    conn.execute(
        "DELETE FROM artist_images WHERE artist_key = ?1 AND browse_mode = ?2",
        params![old_key, browse_mode],
    )?;
    conn.execute(
        "INSERT INTO artist_images (artist_key, browse_mode, art_path)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(artist_key, browse_mode) DO UPDATE SET art_path = excluded.art_path",
        params![new_key, browse_mode, art_path],
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
    let lines_json = serde_json::to_string(&record.lines).map_err(|err| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(err))
    })?;
    let source = record
        .source
        .as_ref()
        .map(lyrics_source_to_str);
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
    conn.execute("DELETE FROM track_lyrics WHERE track_id = ?1", params![track_id])?;
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
            disc_number: None,
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
        }
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
        assert_eq!(playlist_track_ids(&conn, playlist_id).unwrap(), vec![1, 2, 3]);

        reorder_playlist_tracks(&conn, playlist_id, &[3, 1, 2]).unwrap();
        assert_eq!(playlist_track_ids(&conn, playlist_id).unwrap(), vec![3, 1, 2]);
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
    fn increment_play_count_increases_count() {
        let conn = test_conn();
        save_track(&conn, &sample_input("/music/a.mp3")).unwrap();

        assert_eq!(increment_play_count(&conn, 1).unwrap(), 1);
        assert_eq!(increment_play_count(&conn, 1).unwrap(), 2);

        let track = get_track_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(track.play_count, 2);
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
        let conn = test_conn();
        let path = "/music/refresh.mp3";

        save_track(&conn, &sample_input(path)).unwrap();
        increment_play_count(&conn, 1).unwrap();
        increment_play_count(&conn, 1).unwrap();
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
        assert_eq!(after.rating, 128);
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
                disc_number: existing.disc_number,
                year: existing.year,
                genre: existing.genre.clone(),
                art_path: existing.art_path.clone(),
                art_changed: false,
                lyrics: None,
                lyrics_changed: false,
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
