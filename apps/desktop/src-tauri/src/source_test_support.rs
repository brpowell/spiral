//! Databases and files for tests of code that treats sources differently.

use crate::db_migrations;
use crate::sources::{DEFAULT_SOURCE_ID, OTHER_SOURCE_ID};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

pub struct TempDir(pub PathBuf);

impl TempDir {
    pub fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "spiral-sources-{label}-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    /// Create `rel` (a folder) and return its path.
    pub fn dir(&self, rel: &str) -> PathBuf {
        let path = self.0.join(rel);
        std::fs::create_dir_all(&path).unwrap();
        path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub fn conn() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    db_migrations::run(&conn, None).unwrap();
    conn
}

/// One track id per kind of source.
pub struct SourceTracks {
    /// In the default source.
    pub default: i64,
    /// In a source the user added.
    pub user: i64,
    /// In Other.
    pub other: i64,
}

/// Add a user source rooted at `root`.
pub fn add_user_source(conn: &Connection, root: &Path) -> i64 {
    conn.execute(
        "INSERT INTO sources (root_path, name, created_at) VALUES (?1, ?1, 'now')",
        params![root.to_string_lossy()],
    )
    .unwrap();
    conn.last_insert_rowid()
}

/// Insert a track stored as `rel_path` (absolute for Other, and for the
/// default source of an in-memory database).
pub fn insert_track(conn: &Connection, rel_path: &str, source_id: i64) -> i64 {
    conn.execute(
        "INSERT INTO tracks (title, rel_path, date_added, source_id)
         VALUES ('Song', ?1, '2024-01-01T00:00:00Z', ?2)",
        params![rel_path, source_id],
    )
    .unwrap();
    conn.last_insert_rowid()
}

/// One track per kind of source, with files at the given paths. The user
/// source is rooted at the user file's folder.
pub fn source_tracks(conn: &Connection, default: &Path, user: &Path, other: &Path) -> SourceTracks {
    let user_source = add_user_source(conn, user.parent().unwrap());
    let user_name = user.file_name().unwrap().to_string_lossy();
    SourceTracks {
        default: insert_track(conn, &default.to_string_lossy(), DEFAULT_SOURCE_ID),
        user: insert_track(conn, &user_name, user_source),
        other: insert_track(conn, &other.to_string_lossy(), OTHER_SOURCE_ID),
    }
}

pub fn default_source_tracks(conn: &Connection) -> SourceTracks {
    source_tracks(
        conn,
        Path::new("/m.mp3"),
        Path::new("/user/u.mp3"),
        Path::new("/x.mp3"),
    )
}
