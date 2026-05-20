use crate::models::{Track, TrackInput, TrackMetadataUpdate};
use chrono::Utc;
use rusqlite::{params, Connection, Row};
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

fn table_columns(conn: &Connection) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare("PRAGMA table_info(tracks)")?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(columns)
}

fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    let columns = table_columns(conn)?;

    if !columns.iter().any(|c| c == "date_added") {
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

    if !columns.iter().any(|c| c == "play_count") {
        conn.execute(
            "ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0",
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

pub fn list_file_paths(conn: &Connection) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT file_path FROM tracks")?;
    let paths = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(paths)
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
    fn increment_play_count_increases_count() {
        let conn = test_conn();
        save_track(&conn, &sample_input("/music/a.mp3")).unwrap();

        assert_eq!(increment_play_count(&conn, 1).unwrap(), 1);
        assert_eq!(increment_play_count(&conn, 1).unwrap(), 2);

        let track = get_track_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(track.play_count, 2);
    }
}
