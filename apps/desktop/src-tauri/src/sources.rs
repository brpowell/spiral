//! Library sources: where each track's file lives and who owns it.
//!
//! There is one library, and every track belongs to a source:
//! - `managed` is Spiral's tracks folder. Files are copied in and organized.
//!   Its root is not stored; it follows the library location in settings, so
//!   moving the library never touches this table.
//! - `watched` sources are folders the user added, indexed in place. They are
//!   read-only by default: Spiral doesn't move, rename, delete or tag them.
//! - `external` holds files referenced one at a time from anywhere else.
//!
//! The managed and external rows are created by the v3 migration with fixed
//! ids, and the schema stops them from being deleted.

use crate::path_scope::path_forms;
use crate::settings::{self, LibrarySettingsResponse};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const MANAGED_SOURCE_ID: i64 = 1;
pub const EXTERNAL_SOURCE_ID: i64 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    Managed,
    Watched,
    External,
}

impl SourceKind {
    fn parse(value: &str) -> Self {
        match value {
            "managed" => Self::Managed,
            "watched" => Self::Watched,
            _ => Self::External,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: i64,
    pub kind: SourceKind,
    /// Folder a watched source indexes. `None` for managed and external.
    pub root_path: Option<String>,
    pub name: String,
    pub writable: bool,
    pub created_at: String,
}

/// The library folders sources are resolved against.
#[derive(Debug, Clone)]
pub struct LibraryRoots {
    pub library_root: PathBuf,
    pub media_folder: PathBuf,
}

impl LibraryRoots {
    pub fn for_library_root(library_root: &Path) -> Self {
        Self {
            library_root: library_root.to_path_buf(),
            media_folder: settings::media_folder_for_root(library_root),
        }
    }

    pub fn from_settings(library: &LibrarySettingsResponse) -> Self {
        Self {
            library_root: PathBuf::from(&library.library_root),
            media_folder: PathBuf::from(&library.media_folder),
        }
    }
}

const SOURCE_SELECT: &str = "SELECT id, kind, root_path, name, writable, created_at FROM sources";

fn map_source_row(row: &Row<'_>) -> rusqlite::Result<Source> {
    Ok(Source {
        id: row.get(0)?,
        kind: SourceKind::parse(&row.get::<_, String>(1)?),
        root_path: row.get(2)?,
        name: row.get(3)?,
        writable: row.get(4)?,
        created_at: row.get(5)?,
    })
}

pub fn list_sources(conn: &Connection) -> Result<Vec<Source>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!("{SOURCE_SELECT} ORDER BY id"))?;
    let sources = stmt
        .query_map([], map_source_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(sources)
}

pub fn get_source(conn: &Connection, id: i64) -> Result<Option<Source>, rusqlite::Error> {
    conn.query_row(
        &format!("{SOURCE_SELECT} WHERE id = ?1"),
        params![id],
        map_source_row,
    )
    .optional()
}

/// True when `path` is `root` or inside it, comparing each as given and with
/// symlinks resolved (the same forms `path_scope` checks).
fn is_within(path: &Path, root: &Path) -> bool {
    let roots = path_forms(root);
    path_forms(path)
        .iter()
        .any(|p| roots.iter().any(|r| p.starts_with(r)))
}

fn overlaps(a: &Path, b: &Path) -> bool {
    is_within(a, b) || is_within(b, a)
}

/// Resolves paths to sources without re-reading the watched roots each time.
struct Resolver<'a> {
    roots: &'a LibraryRoots,
    watched: Vec<(i64, PathBuf)>,
}

impl<'a> Resolver<'a> {
    fn new(conn: &Connection, roots: &'a LibraryRoots) -> Result<Self, rusqlite::Error> {
        let mut stmt = conn.prepare("SELECT id, root_path FROM sources WHERE kind = 'watched'")?;
        let watched = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    PathBuf::from(row.get::<_, String>(1)?),
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self { roots, watched })
    }

    fn source_for(&self, path: &Path) -> i64 {
        let deepest_watched = self
            .watched
            .iter()
            .filter(|(_, root)| is_within(path, root))
            .max_by_key(|(_, root)| root.components().count());
        if let Some((id, _)) = deepest_watched {
            *id
        } else if is_within(path, &self.roots.media_folder) {
            MANAGED_SOURCE_ID
        } else {
            EXTERNAL_SOURCE_ID
        }
    }
}

/// The source a file at `path` belongs to: the deepest watched root containing
/// it, else managed when it is in the tracks folder, else external.
pub fn source_for_path(
    conn: &Connection,
    roots: &LibraryRoots,
    path: &Path,
) -> Result<i64, rusqlite::Error> {
    Ok(Resolver::new(conn, roots)?.source_for(path))
}

/// Move external tracks whose files fall under the tracks folder or a watched
/// root to that source. Run when the database opens: it backfills tracks that
/// the v3 migration had to leave as external (it can't see the library
/// location), and it is a no-op once they are assigned. Returns how many moved.
pub fn assign_external_tracks(
    conn: &Connection,
    roots: &LibraryRoots,
) -> Result<usize, rusqlite::Error> {
    let resolver = Resolver::new(conn, roots)?;
    let tracks: Vec<(i64, String)> = conn
        .prepare("SELECT id, file_path FROM tracks WHERE source_id = ?1")?
        .query_map(params![EXTERNAL_SOURCE_ID], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<Result<_, _>>()?;

    let mut moved = 0;
    for (id, file_path) in tracks {
        let source_id = resolver.source_for(Path::new(&file_path));
        if source_id != EXTERNAL_SOURCE_ID {
            conn.execute(
                "UPDATE tracks SET source_id = ?1 WHERE id = ?2",
                params![source_id, id],
            )?;
            moved += 1;
        }
    }
    Ok(moved)
}

/// Check a folder can become a watched source: an absolute, existing folder
/// that neither equals, contains nor sits inside another watched root, the
/// tracks folder or the library folder. `exclude` skips one source's own root,
/// for moving that source.
pub fn validate_watched_root(
    conn: &Connection,
    roots: &LibraryRoots,
    root: &Path,
    exclude: Option<i64>,
) -> Result<(), String> {
    if path_forms(root).is_empty() {
        return Err(format!("{} is not an absolute folder path", root.display()));
    }
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }
    if overlaps(root, &roots.library_root) || overlaps(root, &roots.media_folder) {
        return Err(format!(
            "{} overlaps the Spiral library folder",
            root.display()
        ));
    }
    let watched = Resolver::new(conn, roots)
        .map_err(|e| e.to_string())?
        .watched;
    if let Some((_, other)) = watched
        .iter()
        .find(|(id, other)| Some(*id) != exclude && overlaps(root, other))
    {
        return Err(format!(
            "{} overlaps the watched folder {}",
            root.display(),
            other.display()
        ));
    }
    Ok(())
}

/// Add a watched folder, read-only. External tracks already under it move to
/// the new source. `name` defaults to the folder name.
pub fn add_watched_source(
    conn: &Connection,
    roots: &LibraryRoots,
    root_path: &str,
    name: Option<&str>,
) -> Result<Source, String> {
    let root = PathBuf::from(root_path.trim());
    validate_watched_root(conn, roots, &root, None)?;
    let name = name
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string)
        .or_else(|| root.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_else(|| root.to_string_lossy().into_owned());

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO sources (kind, root_path, name, writable, created_at)
         VALUES ('watched', ?1, ?2, 0, ?3)",
        params![root.to_string_lossy(), name, Utc::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    assign_external_tracks(&tx, roots).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    get_source(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Source {id} not found"))
}

/// Remove a watched source and its tracks' rows (with their play history,
/// playlist entries and lyrics). The files were never Spiral's, so they stay
/// where they are. Returns how many track rows were removed.
pub fn remove_watched_source(conn: &Connection, id: i64) -> Result<usize, String> {
    let source = get_source(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Source {id} not found"))?;
    if source.kind != SourceKind::Watched {
        return Err("Only watched folders can be removed".to_string());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let removed = tx
        .execute("DELETE FROM tracks WHERE source_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM sources WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(removed)
}

/// Allow or stop Spiral changing a source's files. The managed source is
/// always writable.
pub fn set_source_writable(conn: &Connection, id: i64, writable: bool) -> Result<(), String> {
    if id == MANAGED_SOURCE_ID && !writable {
        return Err("The Spiral library is always writable".to_string());
    }
    let changed = conn
        .execute(
            "UPDATE sources SET writable = ?1 WHERE id = ?2",
            params![writable, id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("Source {id} not found"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db_migrations;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        db_migrations::run(&conn, None).unwrap();
        conn
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "spiral-sources-{label}-{}-{}",
                std::process::id(),
                Utc::now().timestamp_nanos_opt().unwrap_or_default()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn dir(&self, rel: &str) -> PathBuf {
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

    fn roots(tmp: &TempDir) -> LibraryRoots {
        let library = tmp.dir("Music/Spiral Library");
        tmp.dir("Music/Spiral Library/Tracks");
        LibraryRoots::for_library_root(&library)
    }

    fn insert_track(conn: &Connection, path: &Path, source_id: i64) -> i64 {
        conn.execute(
            "INSERT INTO tracks (title, file_path, date_added, source_id)
             VALUES ('Song', ?1, '2024-01-01T00:00:00Z', ?2)",
            params![path.to_string_lossy(), source_id],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn track_source(conn: &Connection, id: i64) -> i64 {
        conn.query_row(
            "SELECT source_id FROM tracks WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn add(conn: &Connection, roots: &LibraryRoots, root: &Path) -> Result<Source, String> {
        add_watched_source(conn, roots, &root.to_string_lossy(), None)
    }

    #[test]
    fn migration_seeds_managed_and_external() {
        let conn = test_conn();
        let sources = list_sources(&conn).unwrap();
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].id, MANAGED_SOURCE_ID);
        assert_eq!(sources[0].kind, SourceKind::Managed);
        assert!(sources[0].writable);
        assert_eq!(sources[0].root_path, None);
        assert_eq!(sources[1].id, EXTERNAL_SOURCE_ID);
        assert_eq!(sources[1].kind, SourceKind::External);
        assert!(!sources[1].writable);
        assert_eq!(sources[1].root_path, None);
    }

    #[test]
    fn schema_allows_one_managed_and_one_external() {
        let conn = test_conn();
        for kind in ["managed", "external"] {
            let err = conn.execute(
                "INSERT INTO sources (kind, name, created_at) VALUES (?1, 'x', 'now')",
                params![kind],
            );
            assert!(err.is_err(), "second {kind} row was accepted");
        }
        assert!(conn
            .execute(
                "DELETE FROM sources WHERE id = ?1",
                params![MANAGED_SOURCE_ID]
            )
            .is_err());
        assert!(conn
            .execute(
                "DELETE FROM sources WHERE id = ?1",
                params![EXTERNAL_SOURCE_ID]
            )
            .is_err());
        assert!(conn
            .execute(
                "UPDATE sources SET kind = 'watched', root_path = '/x' WHERE id = 2",
                []
            )
            .is_err());
    }

    #[test]
    fn schema_requires_root_only_for_watched_and_unique_roots() {
        let conn = test_conn();
        assert!(conn
            .execute(
                "INSERT INTO sources (kind, name, created_at) VALUES ('watched', 'x', 'now')",
                [],
            )
            .is_err());
        conn.execute(
            "INSERT INTO sources (kind, root_path, name, created_at) VALUES ('watched', '/a', 'a', 'now')",
            [],
        )
        .unwrap();
        assert!(conn
            .execute(
                "INSERT INTO sources (kind, root_path, name, created_at) VALUES ('watched', '/a', 'b', 'now')",
                [],
            )
            .is_err());
    }

    #[test]
    fn tracks_require_an_existing_source() {
        let conn = test_conn();
        let missing = conn.execute(
            "INSERT INTO tracks (title, file_path, date_added) VALUES ('S', '/a.mp3', 'now')",
            [],
        );
        assert!(missing.is_err());
        let dangling = conn.execute(
            "INSERT INTO tracks (title, file_path, date_added, source_id) VALUES ('S', '/a.mp3', 'now', 99)",
            [],
        );
        assert!(dangling.is_err());
    }

    #[test]
    fn multiple_separate_watched_folders_can_be_added() {
        let tmp = TempDir::new("multi");
        let conn = test_conn();
        let roots = roots(&tmp);
        let a = add(&conn, &roots, &tmp.dir("Collection/Rock")).unwrap();
        let b = add(&conn, &roots, &tmp.dir("Collection/Jazz")).unwrap();
        let c = add(&conn, &roots, &tmp.dir("Music/Other")).unwrap();
        assert_eq!(a.kind, SourceKind::Watched);
        assert_eq!(a.name, "Rock");
        assert!(!a.writable);
        assert_ne!(a.id, b.id);
        assert_ne!(b.id, c.id);
        assert_eq!(list_sources(&conn).unwrap().len(), 5);
    }

    #[test]
    fn watched_root_cannot_overlap_another_watched_root() {
        let tmp = TempDir::new("overlap");
        let conn = test_conn();
        let roots = roots(&tmp);
        add(&conn, &roots, &tmp.dir("Collection/Rock")).unwrap();

        let equal = add(&conn, &roots, &tmp.dir("Collection/Rock"));
        let inside = add(&conn, &roots, &tmp.dir("Collection/Rock/Live"));
        let containing = add(&conn, &roots, &tmp.dir("Collection"));
        assert!(equal.is_err());
        assert!(inside.is_err());
        assert!(containing.is_err());
        assert_eq!(list_sources(&conn).unwrap().len(), 3);
    }

    #[test]
    fn watched_root_cannot_overlap_the_library() {
        let tmp = TempDir::new("library");
        let conn = test_conn();
        let roots = roots(&tmp);
        for root in [
            roots.library_root.clone(),
            roots.media_folder.clone(),
            tmp.dir("Music/Spiral Library/Tracks/Artist"),
            tmp.dir("Music/Spiral Library/Artwork"),
            tmp.dir("Music"),
            tmp.0.clone(),
        ] {
            assert!(
                add(&conn, &roots, &root).is_err(),
                "{} was accepted",
                root.display()
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn watched_root_overlap_is_checked_through_symlinks() {
        let tmp = TempDir::new("symlink");
        let conn = test_conn();
        let roots = roots(&tmp);
        let real = tmp.dir("Collection");
        add(&conn, &roots, &real).unwrap();
        let link = tmp.0.join("Link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(add(&conn, &roots, &link).is_err());
        let library_link = tmp.0.join("LibraryLink");
        std::os::unix::fs::symlink(&roots.media_folder, &library_link).unwrap();
        assert!(add(&conn, &roots, &library_link).is_err());
    }

    #[test]
    fn watched_root_must_be_an_existing_absolute_folder() {
        let tmp = TempDir::new("invalid");
        let conn = test_conn();
        let roots = roots(&tmp);
        assert!(add(&conn, &roots, Path::new("relative/folder")).is_err());
        assert!(add(&conn, &roots, &tmp.0.join("missing")).is_err());
    }

    #[test]
    fn source_for_path_prefers_watched_then_managed_then_external() {
        let tmp = TempDir::new("resolve");
        let conn = test_conn();
        let roots = roots(&tmp);
        let rock = add(&conn, &roots, &tmp.dir("Collection/Rock")).unwrap();
        // Nested roots are refused by validation; insert one directly to check
        // that the deepest root wins regardless.
        let live = tmp.dir("Collection/Rock/Live");
        conn.execute(
            "INSERT INTO sources (kind, root_path, name, created_at) VALUES ('watched', ?1, 'Live', 'now')",
            params![live.to_string_lossy()],
        )
        .unwrap();
        let live_id = conn.last_insert_rowid();

        let resolve = |p: PathBuf| source_for_path(&conn, &roots, &p).unwrap();
        assert_eq!(resolve(tmp.0.join("Collection/Rock/a.mp3")), rock.id);
        assert_eq!(resolve(live.join("b.mp3")), live_id);
        assert_eq!(
            resolve(roots.media_folder.join("A/B/c.mp3")),
            MANAGED_SOURCE_ID
        );
        assert_eq!(
            resolve(roots.library_root.join("d.mp3")),
            EXTERNAL_SOURCE_ID
        );
        assert_eq!(
            resolve(tmp.0.join("Collection/RockAndRoll/e.mp3")),
            EXTERNAL_SOURCE_ID
        );
        assert_eq!(resolve(tmp.0.join("Downloads/f.mp3")), EXTERNAL_SOURCE_ID);
    }

    #[cfg(unix)]
    #[test]
    fn source_for_path_matches_symlinked_spellings() {
        let tmp = TempDir::new("resolve-link");
        let conn = test_conn();
        let roots = roots(&tmp);
        let link = tmp.0.join("TracksLink");
        std::os::unix::fs::symlink(&roots.media_folder, &link).unwrap();
        std::fs::write(roots.media_folder.join("a.mp3"), b"x").unwrap();
        assert_eq!(
            source_for_path(&conn, &roots, &link.join("a.mp3")).unwrap(),
            MANAGED_SOURCE_ID
        );
    }

    #[test]
    fn assign_external_tracks_backfills_managed_and_watched() {
        let tmp = TempDir::new("backfill");
        let conn = test_conn();
        let roots = roots(&tmp);
        let managed = insert_track(
            &conn,
            &roots.media_folder.join("A/a.mp3"),
            EXTERNAL_SOURCE_ID,
        );
        let elsewhere = insert_track(&conn, &tmp.0.join("Downloads/b.mp3"), EXTERNAL_SOURCE_ID);
        let watched_file = tmp.dir("Collection").join("c.mp3");
        let watched = insert_track(&conn, &watched_file, EXTERNAL_SOURCE_ID);

        assert_eq!(assign_external_tracks(&conn, &roots).unwrap(), 1);
        assert_eq!(track_source(&conn, managed), MANAGED_SOURCE_ID);
        assert_eq!(track_source(&conn, elsewhere), EXTERNAL_SOURCE_ID);
        assert_eq!(track_source(&conn, watched), EXTERNAL_SOURCE_ID);

        // Adding a watched folder claims the external tracks inside it.
        let collection = add(&conn, &roots, &tmp.0.join("Collection")).unwrap();
        assert_eq!(track_source(&conn, watched), collection.id);
        assert_eq!(assign_external_tracks(&conn, &roots).unwrap(), 0);
    }

    #[test]
    fn removing_a_watched_source_removes_its_tracks_only() {
        let tmp = TempDir::new("remove");
        let conn = test_conn();
        let roots = roots(&tmp);
        let rock = add(&conn, &roots, &tmp.dir("Rock")).unwrap();
        let jazz = add(&conn, &roots, &tmp.dir("Jazz")).unwrap();
        let rock_track = insert_track(&conn, &tmp.0.join("Rock/a.mp3"), rock.id);
        let jazz_track = insert_track(&conn, &tmp.0.join("Jazz/b.mp3"), jazz.id);
        let managed_track =
            insert_track(&conn, &roots.media_folder.join("c.mp3"), MANAGED_SOURCE_ID);

        assert_eq!(remove_watched_source(&conn, rock.id).unwrap(), 1);
        assert_eq!(get_source(&conn, rock.id).unwrap(), None);
        let remaining: Vec<i64> = conn
            .prepare("SELECT id FROM tracks ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(remaining, vec![jazz_track, managed_track]);
        assert!(!remaining.contains(&rock_track));
        assert!(tmp.0.join("Rock").is_dir());

        assert!(remove_watched_source(&conn, MANAGED_SOURCE_ID).is_err());
        assert!(remove_watched_source(&conn, EXTERNAL_SOURCE_ID).is_err());
        assert!(remove_watched_source(&conn, 999).is_err());
    }

    #[test]
    fn set_source_writable_toggles_except_managed() {
        let tmp = TempDir::new("writable");
        let conn = test_conn();
        let roots = roots(&tmp);
        let rock = add(&conn, &roots, &tmp.dir("Rock")).unwrap();
        set_source_writable(&conn, rock.id, true).unwrap();
        assert!(get_source(&conn, rock.id).unwrap().unwrap().writable);
        set_source_writable(&conn, rock.id, false).unwrap();
        assert!(!get_source(&conn, rock.id).unwrap().unwrap().writable);
        assert!(set_source_writable(&conn, MANAGED_SOURCE_ID, false).is_err());
        assert!(set_source_writable(&conn, 999, true).is_err());
    }
}
