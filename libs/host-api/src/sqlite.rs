//! [`HostLibrary`] over a host's SQLite `Library.db`.

use crate::library::{is_artwork_hash, ArtworkOriginal, HostFuture, HostLibrary, HostLibraryError};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use spiral_sync::host_db::{self, HostDbError};
use spiral_sync::{ChangesResponse, HostState, Snapshot, SyncCursor};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

/// The Spiral folder's artwork store. Every `artwork_file.rel_path` is under it.
const ARTWORK_DIR: &str = "Artwork";

/// Reads a `Library.db` with the `spiral_sync::host_db` readers.
///
/// Every call opens its own read-only connection on a blocking thread. Opening
/// a local SQLite file costs far less than reading a snapshot, and it keeps
/// reads independent: concurrent requests read in parallel instead of queueing
/// on one shared connection (a `Connection` is not `Sync`), and no connection
/// sits open between requests holding a stale schema cache.
///
/// A read-only connection can't roll back a hot journal that a crashed writer
/// left behind, so after the desktop app crashes mid-write every read fails
/// until the app opens the database again and recovers it.
#[derive(Debug, Clone)]
pub struct SqliteHostLibrary {
    inner: Arc<Paths>,
}

#[derive(Debug)]
struct Paths {
    db_path: PathBuf,
    /// The Spiral folder: relative `sources.root_path` values and artwork
    /// `rel_path`s resolve against it.
    spiral_folder: PathBuf,
}

impl SqliteHostLibrary {
    /// Checks that `db_path` opens read-only as a supported host database and
    /// keeps both paths for later calls.
    pub async fn open(
        db_path: impl Into<PathBuf>,
        spiral_folder: impl Into<PathBuf>,
    ) -> Result<Self, HostLibraryError> {
        let library = SqliteHostLibrary {
            inner: Arc::new(Paths {
                db_path: db_path.into(),
                spiral_folder: spiral_folder.into(),
            }),
        };
        library
            .read(|conn| host_db::read_host_state(conn).map(drop))
            .await?;
        Ok(library)
    }

    pub fn db_path(&self) -> &Path {
        &self.inner.db_path
    }

    pub fn spiral_folder(&self) -> &Path {
        &self.inner.spiral_folder
    }

    /// Runs `work` on a blocking thread with a fresh read-only connection.
    async fn blocking<T, F>(&self, work: F) -> Result<T, HostLibraryError>
    where
        T: Send + 'static,
        F: FnOnce(&Paths, &Connection) -> Result<T, HostLibraryError> + Send + 'static,
    {
        let paths = Arc::clone(&self.inner);
        tokio::task::spawn_blocking(move || {
            let conn = Connection::open_with_flags(
                &paths.db_path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
            .map_err(HostLibraryError::storage)?;
            work(&paths, &conn)
        })
        .await
        .map_err(HostLibraryError::storage)?
    }

    async fn read<T, F>(&self, read: F) -> Result<T, HostLibraryError>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, HostDbError> + Send + 'static,
    {
        self.blocking(|_, conn| read(conn).map_err(HostLibraryError::storage))
            .await
    }
}

impl HostLibrary for SqliteHostLibrary {
    fn host_state(&self) -> HostFuture<'_, HostState> {
        Box::pin(self.read(host_db::read_host_state))
    }

    fn snapshot(&self) -> HostFuture<'_, Snapshot> {
        Box::pin(self.read(host_db::read_snapshot))
    }

    fn changes<'a>(&'a self, cursor: &'a SyncCursor) -> HostFuture<'a, ChangesResponse> {
        let cursor = cursor.clone();
        Box::pin(self.read(move |conn| host_db::read_changes(conn, &cursor)))
    }

    fn track_file<'a>(&'a self, track_id: &'a str) -> HostFuture<'a, Option<PathBuf>> {
        let track_id = track_id.to_owned();
        Box::pin(self.blocking(move |paths, conn| {
            let row: Option<(Option<String>, String)> = conn
                .query_row(
                    "SELECT s.root_path, t.rel_path FROM tracks t
                     JOIN sources s ON s.id = t.source_id
                     WHERE t.id = ?1",
                    [&track_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(HostLibraryError::storage)?;
            let Some((Some(root_path), rel_path)) = row else {
                return Ok(None);
            };
            Ok(resolve_stored_root(&root_path, &paths.spiral_folder)
                .and_then(|root| contained_file(&root, &rel_path)))
        }))
    }

    fn artwork_original<'a>(&'a self, hash: &'a str) -> HostFuture<'a, Option<ArtworkOriginal>> {
        let hash = hash.to_owned();
        Box::pin(self.blocking(move |paths, conn| {
            if !is_artwork_hash(&hash) {
                return Ok(None);
            }
            artwork_original(conn, &paths.spiral_folder, &hash).map_err(HostLibraryError::storage)
        }))
    }
}

/// A stored `sources.root_path` as a folder: as stored when absolute, else
/// relative to the Spiral folder.
///
/// Duplicates the desktop's `sources::resolve_stored_root`. Both belong in the
/// shared librarian crate, so source-root resolution and the containment check
/// in [`contained_file`] live in one function.
fn resolve_stored_root(stored: &str, spiral_folder: &Path) -> Option<PathBuf> {
    if Path::new(stored).is_absolute() {
        Some(PathBuf::from(stored))
    } else {
        join_rel_path(spiral_folder, stored)
    }
}

/// `rel_path` (`/`-separated) under `base`, joined part by part. `None` when a
/// part is empty, `.`, `..`, or absolute: a stored path never climbs out.
fn join_rel_path(base: &Path, rel_path: &str) -> Option<PathBuf> {
    let mut path = base.to_path_buf();
    for part in rel_path.split('/') {
        let mut components = Path::new(part).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(name)), None) if name == part => path.push(name),
            _ => return None,
        }
    }
    Some(path)
}

/// The file at `rel_path` under `root`, only when it exists and is still
/// inside `root` once both are canonicalized, so a symlink that points out of
/// the root isn't followed. The desktop's rule for paths it serves (#188, in
/// `commands/files.rs` and `path_scope.rs`).
fn contained_file(root: &Path, rel_path: &str) -> Option<PathBuf> {
    let root = fs::canonicalize(root).ok()?;
    let file = fs::canonicalize(join_rel_path(&root, rel_path)?).ok()?;
    (file.starts_with(&root) && file.is_file()).then_some(file)
}

/// Size and modified time in ms, as the desktop records them in `artwork_file`.
fn file_stat(path: &Path) -> Option<(i64, i64)> {
    let meta = fs::metadata(path).ok().filter(|m| m.is_file())?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as i64);
    Some((meta.len() as i64, mtime))
}

/// The first recorded copy of `hash` that is still intact under the Spiral
/// folder's `Artwork/`.
///
/// Duplicates the desktop's `artwork_registry::files_for_hash` and
/// `ArtworkFile::is_intact`. Both belong in the shared librarian crate.
fn artwork_original(
    conn: &Connection,
    spiral_folder: &Path,
    hash: &str,
) -> rusqlite::Result<Option<ArtworkOriginal>> {
    let image = conn
        .query_row(
            "SELECT mime, width, height, byte_size FROM artwork WHERE hash = ?1",
            [hash],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()?;
    let Some((mime, width, height, byte_size)) = image else {
        return Ok(None);
    };
    let files: Vec<(String, i64, i64)> = conn
        .prepare(
            "SELECT rel_path, size, mtime_ms FROM artwork_file WHERE hash = ?1 ORDER BY rel_path",
        )?
        .query_map([hash], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<Result<_, _>>()?;
    let Ok(artwork_root) = fs::canonicalize(spiral_folder.join(ARTWORK_DIR)) else {
        return Ok(None);
    };
    let path = files.into_iter().find_map(|(rel_path, size, mtime_ms)| {
        let under_artwork = rel_path.strip_prefix(ARTWORK_DIR)?.strip_prefix('/')?;
        let file = contained_file(&artwork_root, under_artwork)?;
        (file_stat(&file)? == (size, mtime_ms)).then_some(file)
    });
    let dimension = |v: Option<i64>| v.and_then(|v| u32::try_from(v).ok()).filter(|&v| v > 0);
    Ok(path.map(|path| {
        ArtworkOriginal::new(
            path,
            mime,
            dimension(width),
            dimension(height),
            u64::try_from(byte_size).unwrap_or(0),
        )
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_rel_path_refuses_parts_that_leave_the_base() {
        let base = Path::new("/base");
        assert_eq!(
            join_rel_path(base, "a/b.flac"),
            Some(PathBuf::from("/base/a/b.flac"))
        );
        for bad in [
            "", "a//b", "/a", "a/", ".", "./a", "a/./b", "..", "../a", "a/../b", "a/..",
        ] {
            assert_eq!(join_rel_path(base, bad), None, "{bad:?}");
        }
    }

    #[test]
    fn a_relative_root_resolves_against_the_spiral_folder() {
        let spiral = Path::new("/spiral");
        assert_eq!(
            resolve_stored_root("Tracks", spiral),
            Some(PathBuf::from("/spiral/Tracks"))
        );
        assert_eq!(
            resolve_stored_root("/music", spiral),
            Some(PathBuf::from("/music"))
        );
        assert_eq!(resolve_stored_root("../out", spiral), None);
    }
}
