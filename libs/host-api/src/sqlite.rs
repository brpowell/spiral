//! [`HostLibrary`] over a host's SQLite `Library.db`.

use crate::library::{HostFuture, HostLibrary, HostLibraryError};
use rusqlite::{Connection, OpenFlags};
use spiral_sync::host_db::{self, HostDbError};
use spiral_sync::{ChangesResponse, HostState, Snapshot, SyncCursor};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Reads a `Library.db` with the `spiral_sync::host_db` readers.
///
/// Every call opens its own read-only connection on a blocking thread. Opening
/// a local SQLite file costs far less than reading a snapshot, and it keeps
/// reads independent: concurrent requests read in parallel instead of queueing
/// on one shared connection (a `Connection` is not `Sync`), and no connection
/// sits open between requests holding a stale schema cache.
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

    async fn read<T, F>(&self, read: F) -> Result<T, HostLibraryError>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, HostDbError> + Send + 'static,
    {
        let paths = Arc::clone(&self.inner);
        tokio::task::spawn_blocking(move || {
            let conn = Connection::open_with_flags(
                &paths.db_path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
            .map_err(HostLibraryError::storage)?;
            read(&conn).map_err(HostLibraryError::storage)
        })
        .await
        .map_err(HostLibraryError::storage)?
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
}
