use crate::models::{ArtistImage, Playlist, PlaylistImageMode, Track, TrackInput, TrackMetadataUpdate};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
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
  file_path TEXT NOT NULL UNIQUE,
  art_path TEXT,
  date_added TEXT NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 0
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
";

const TRACK_SELECT: &str = "SELECT id, title, artist, album, album_artist, track_number, disc_number,
                year, genre, duration_seconds, file_path, art_path, date_added, play_count";

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
        file_path: row.get(10)?,
        art_path: row.get(11)?,
        date_added: row.get(12)?,
        play_count: row.get(13)?,
    })
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
    conn.execute(
        "INSERT INTO tracks (
            title, artist, album, album_artist, track_number, disc_number,
            year, genre, duration_seconds, file_path, art_path, date_added
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
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
            art_path = excluded.art_path",
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
            input.file_path,
            input.art_path,
            date_added,
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

pub fn get_all_tracks(conn: &Connection) -> Result<Vec<Track>, rusqlite::Error> {
    let sql = format!(
        "{TRACK_SELECT}
         FROM tracks
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
) -> Result<(), rusqlite::Error> {
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
    Ok(())
}

pub fn get_track_by_id(conn: &Connection, id: i64) -> Result<Option<Track>, rusqlite::Error> {
    let sql = format!("{TRACK_SELECT} FROM tracks WHERE id = ?1");
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
         ORDER BY title COLLATE NOCASE",
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
    conn.execute(
        "INSERT INTO playlists (title, description, date_created, last_used_at, image_mode, custom_image_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            title,
            description,
            now,
            now,
            playlist_image_mode_str(image_mode),
            custom_image_path,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TrackInput;

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
            file_path: path.into(),
            art_path: None,
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
    fn increment_play_count_increases_count() {
        let conn = test_conn();
        save_track(&conn, &sample_input("/music/a.mp3")).unwrap();

        assert_eq!(increment_play_count(&conn, 1).unwrap(), 1);
        assert_eq!(increment_play_count(&conn, 1).unwrap(), 2);

        let track = get_track_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(track.play_count, 2);
    }
}
