//! What Spiral may do to a track's file, decided by the track's source.
//!
//! Every code path that changes a file on disk asks [`track_permissions`]:
//! - `writable`: tags, embedded art, lyrics and lyrics sidecars may be written.
//!   True for managed tracks and for watched sources the user made writable.
//! - `managed`: the file is Spiral's, so it may also be moved, renamed,
//!   replaced or deleted. Only the managed source qualifies, even when a
//!   watched source is writable.
//!
//! Explicit edits on a track that isn't allowed fail with an error that starts
//! with [`SOURCE_READ_ONLY`]. Background writes skip such tracks silently.

use rusqlite::{params, Connection, OptionalExtension};

/// Prefix of the error returned when a track's source forbids a file change.
/// The UI recognizes it with `message.startsWith("source_read_only")`.
pub const SOURCE_READ_ONLY: &str = "source_read_only";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrackPermissions {
    pub writable: bool,
    pub managed: bool,
}

impl TrackPermissions {
    /// Fail with a `source_read_only` error unless the file may be written.
    pub fn require_writable(self, action: &str) -> Result<(), String> {
        if self.writable {
            Ok(())
        } else {
            Err(read_only_error(action))
        }
    }

    /// Fail with a `source_read_only` error unless the file is Spiral's.
    pub fn require_managed(self, action: &str) -> Result<(), String> {
        if self.managed {
            Ok(())
        } else {
            Err(read_only_error(action))
        }
    }
}

pub fn read_only_error(action: &str) -> String {
    format!("{SOURCE_READ_ONLY}: {action} is not allowed because this file is not in the Spiral library or its folder is read-only")
}

/// Permissions for the track's file. External files are never writable, even
/// if their source row says otherwise.
pub fn track_permissions(conn: &Connection, track_id: i64) -> Result<TrackPermissions, String> {
    let row: Option<(String, bool)> = conn
        .query_row(
            "SELECT s.kind, s.writable FROM tracks t JOIN sources s ON s.id = t.source_id
             WHERE t.id = ?1",
            params![track_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (kind, writable) = row.ok_or_else(|| format!("Track {track_id} not found"))?;
    let managed = kind == "managed";
    Ok(TrackPermissions {
        writable: managed || (kind == "watched" && writable),
        managed,
    })
}

#[cfg(test)]
pub(crate) mod test_support {
    use crate::db_migrations;
    use crate::sources::{EXTERNAL_SOURCE_ID, MANAGED_SOURCE_ID};
    use rusqlite::{params, Connection};
    use std::path::{Path, PathBuf};

    pub struct TempDir(pub PathBuf);

    impl TempDir {
        pub fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "spiral-perms-{label}-{}-{}",
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

    /// Track ids for the four kinds of file the guards distinguish.
    pub struct SourceTracks {
        pub managed: i64,
        pub watched_read_only: i64,
        pub watched_writable: i64,
        pub external: i64,
    }

    pub fn add_watched(conn: &Connection, root: &str, writable: bool) -> i64 {
        conn.execute(
            "INSERT INTO sources (kind, root_path, name, writable, created_at)
             VALUES ('watched', ?1, ?1, ?2, 'now')",
            params![root, writable],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    pub fn insert_track(conn: &Connection, path: &Path, source_id: i64) -> i64 {
        conn.execute(
            "INSERT INTO tracks (title, file_path, date_added, source_id)
             VALUES ('Song', ?1, '2024-01-01T00:00:00Z', ?2)",
            params![path.to_string_lossy(), source_id],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    /// One track per source kind, with files at the given paths.
    pub fn source_tracks(
        conn: &Connection,
        managed: &Path,
        watched_read_only: &Path,
        watched_writable: &Path,
        external: &Path,
    ) -> SourceTracks {
        let ro = add_watched(conn, "/watched/read-only", false);
        let rw = add_watched(conn, "/watched/writable", true);
        SourceTracks {
            managed: insert_track(conn, managed, MANAGED_SOURCE_ID),
            watched_read_only: insert_track(conn, watched_read_only, ro),
            watched_writable: insert_track(conn, watched_writable, rw),
            external: insert_track(conn, external, EXTERNAL_SOURCE_ID),
        }
    }

    pub fn default_source_tracks(conn: &Connection) -> SourceTracks {
        source_tracks(
            conn,
            Path::new("/m.mp3"),
            Path::new("/ro.mp3"),
            Path::new("/rw.mp3"),
            Path::new("/x.mp3"),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;
    use crate::sources::EXTERNAL_SOURCE_ID;

    #[test]
    fn permissions_follow_the_source() {
        let conn = conn();
        let t = default_source_tracks(&conn);
        let perms = |id| track_permissions(&conn, id).unwrap();
        assert_eq!(
            perms(t.managed),
            TrackPermissions {
                writable: true,
                managed: true
            }
        );
        assert_eq!(
            perms(t.watched_read_only),
            TrackPermissions {
                writable: false,
                managed: false
            }
        );
        assert_eq!(
            perms(t.watched_writable),
            TrackPermissions {
                writable: true,
                managed: false
            }
        );
        assert_eq!(
            perms(t.external),
            TrackPermissions {
                writable: false,
                managed: false
            }
        );
    }

    #[test]
    fn external_is_never_writable() {
        let conn = conn();
        let t = default_source_tracks(&conn);
        conn.execute(
            "UPDATE sources SET writable = 1 WHERE id = ?1",
            params![EXTERNAL_SOURCE_ID],
        )
        .unwrap();
        assert!(!track_permissions(&conn, t.external).unwrap().writable);
    }

    #[test]
    fn missing_track_is_an_error() {
        let conn = conn();
        assert!(track_permissions(&conn, 999).is_err());
    }

    #[test]
    fn refusals_carry_the_read_only_code() {
        let read_only = TrackPermissions {
            writable: false,
            managed: false,
        };
        let err = read_only.require_writable("Editing tags").unwrap_err();
        assert!(err.starts_with(SOURCE_READ_ONLY), "{err}");
        let writable_watched = TrackPermissions {
            writable: true,
            managed: false,
        };
        assert!(writable_watched.require_writable("Editing tags").is_ok());
        let err = writable_watched.require_managed("Replacing").unwrap_err();
        assert!(err.starts_with(SOURCE_READ_ONLY), "{err}");
    }
}
