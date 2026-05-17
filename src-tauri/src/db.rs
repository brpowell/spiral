use crate::models::{Track, TrackInput, TrackMetadataUpdate};
use chrono::Utc;
use rusqlite::{params, Connection};
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
  date_added TEXT NOT NULL
);
";

pub fn open(db_path: &Path) -> Result<Connection, rusqlite::Error> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let conn = Connection::open(db_path)?;
    conn.execute_batch(SCHEMA)?;
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
            art_path = excluded.art_path,
            date_added = excluded.date_added",
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

pub fn get_all_tracks(conn: &Connection) -> Result<Vec<Track>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, title, artist, album, album_artist, track_number, disc_number,
                year, genre, duration_seconds, file_path, art_path, date_added
         FROM tracks
         ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_number",
    )?;

    let tracks = stmt
        .query_map([], |row| {
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
            })
        })?
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
    let mut stmt = conn.prepare(
        "SELECT id, title, artist, album, album_artist, track_number, disc_number,
                year, genre, duration_seconds, file_path, art_path, date_added
         FROM tracks WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(Track {
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
        }))
    } else {
        Ok(None)
    }
}

pub fn delete_track(conn: &Connection, id: i64) -> Result<bool, rusqlite::Error> {
    let deleted = conn.execute("DELETE FROM tracks WHERE id = ?1", params![id])?;
    Ok(deleted > 0)
}
