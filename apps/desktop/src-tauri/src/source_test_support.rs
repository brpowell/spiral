//! Databases and files for tests of code that treats sources differently.

use crate::db_migrations;
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
    /// In an organized source that is the import target, like onboarding's
    /// `Tracks`.
    pub managed: i64,
    /// In a source the user added.
    pub user: i64,
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

/// Add an organized source rooted at `root` and make it the import target,
/// as onboarding's `Tracks` is.
pub fn add_managed_source(conn: &Connection, root: &Path) -> i64 {
    let id = add_user_source(conn, root);
    conn.execute(
        "UPDATE sources SET auto_organize = 1, import_target = 1 WHERE id = ?1",
        params![id],
    )
    .unwrap();
    id
}

/// Insert a track stored as `rel_path`.
pub fn insert_track(conn: &Connection, rel_path: &str, source_id: i64) -> i64 {
    conn.execute(
        "INSERT INTO tracks (title, rel_path, date_added, source_id)
         VALUES ('Song', ?1, '2024-01-01T00:00:00Z', ?2)",
        params![rel_path, source_id],
    )
    .unwrap();
    conn.last_insert_rowid()
}

/// One track per kind of source, with files at the given paths. The managed
/// and user sources are rooted at their file's folder.
pub fn source_tracks(conn: &Connection, managed: &Path, user: &Path) -> SourceTracks {
    let managed_source = add_managed_source(conn, managed.parent().unwrap());
    let managed_name = managed.file_name().unwrap().to_string_lossy();
    let user_source = add_user_source(conn, user.parent().unwrap());
    let user_name = user.file_name().unwrap().to_string_lossy();
    SourceTracks {
        managed: insert_track(conn, &managed_name, managed_source),
        user: insert_track(conn, &user_name, user_source),
    }
}

pub fn default_source_tracks(conn: &Connection) -> SourceTracks {
    source_tracks(conn, Path::new("/managed/m.mp3"), Path::new("/user/u.mp3"))
}
