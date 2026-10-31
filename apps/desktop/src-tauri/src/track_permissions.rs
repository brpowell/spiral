//! What Spiral may do to a track's file, decided by the track's source.
//!
//! Every code path that changes a file on disk asks [`track_permissions`]:
//! - `writable`: tags, embedded art, lyrics and lyrics sidecars may be written.
//!   True for every source but Other.
//! - `managed`: the file is Spiral's, so it may also be moved, renamed,
//!   replaced or deleted. Only the default source qualifies for now.
//!
//! Explicit edits on a track that isn't allowed fail with an error that starts
//! with [`SOURCE_READ_ONLY`]. Background writes skip such tracks silently.

use crate::sources::{DEFAULT_SOURCE_ID, OTHER_SOURCE_ID};
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

/// Permissions for the track's file. Until per-source behavior lands, every
/// source but Other is writable, and only the default source's files are
/// Spiral's to move, replace or delete.
pub fn track_permissions(conn: &Connection, track_id: i64) -> Result<TrackPermissions, String> {
    let source_id: i64 = conn
        .query_row(
            "SELECT source_id FROM tracks WHERE id = ?1",
            params![track_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track {track_id} not found"))?;
    Ok(TrackPermissions {
        writable: source_id != OTHER_SOURCE_ID,
        managed: source_id == DEFAULT_SOURCE_ID,
    })
}

#[cfg(test)]
pub(crate) mod test_support {
    use crate::db_migrations;
    use crate::sources::{DEFAULT_SOURCE_ID, OTHER_SOURCE_ID};
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

    /// Track ids for the three kinds of file the guards distinguish.
    pub struct SourceTracks {
        /// In the default source.
        pub managed: i64,
        /// In a source the user added.
        pub user: i64,
        /// In Other.
        pub external: i64,
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
    pub fn source_tracks(
        conn: &Connection,
        managed: &Path,
        user: &Path,
        external: &Path,
    ) -> SourceTracks {
        let user_source = add_user_source(conn, user.parent().unwrap());
        let user_name = user.file_name().unwrap().to_string_lossy();
        SourceTracks {
            managed: insert_track(conn, &managed.to_string_lossy(), DEFAULT_SOURCE_ID),
            user: insert_track(conn, &user_name, user_source),
            external: insert_track(conn, &external.to_string_lossy(), OTHER_SOURCE_ID),
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
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;

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
            perms(t.user),
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
        let writable_user = TrackPermissions {
            writable: true,
            managed: false,
        };
        assert!(writable_user.require_writable("Editing tags").is_ok());
        let err = writable_user.require_managed("Replacing").unwrap_err();
        assert!(err.starts_with(SOURCE_READ_ONLY), "{err}");
    }
}
