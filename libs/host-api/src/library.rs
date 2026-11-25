//! Where the API's data comes from.

use spiral_sync::{ChangesResponse, HostState, Snapshot, SyncCursor};
use std::error::Error;
use std::fmt;
use std::future::Future;
use std::pin::Pin;

/// A boxed future from a [`HostLibrary`] method.
pub type HostFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, HostLibraryError>> + Send + 'a>>;

/// A host's library, as the API reads it.
///
/// The router holds it as `Arc<dyn HostLibrary>`, so one router type serves
/// any library (the desktop app's, a headless host's, a test fake) and the
/// host picks it at runtime. Methods return boxed futures because `async fn`
/// in a trait can't be called through `dyn`.
///
/// Later methods (opening audio for a transcoding profile, writing a rating
/// back) are added with default bodies, so an implementation that doesn't
/// support one keeps compiling and the route reports it unsupported.
pub trait HostLibrary: Send + Sync + 'static {
    /// The library id and where its change feed stands.
    fn host_state(&self) -> HostFuture<'_, HostState>;

    /// The whole catalog at the current rev.
    fn snapshot(&self) -> HostFuture<'_, Snapshot>;

    /// The changes after `cursor`, or that the client must resnapshot.
    fn changes<'a>(&'a self, cursor: &'a SyncCursor) -> HostFuture<'a, ChangesResponse>;
}

/// Why a [`HostLibrary`] couldn't answer.
#[derive(Debug)]
#[non_exhaustive]
pub enum HostLibraryError {
    /// The library's storage failed. The API answers 500 and logs the
    /// details; clients never see them.
    Storage(Box<dyn Error + Send + Sync>),
}

impl HostLibraryError {
    pub fn storage(e: impl Into<Box<dyn Error + Send + Sync>>) -> Self {
        HostLibraryError::Storage(e.into())
    }
}

impl fmt::Display for HostLibraryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HostLibraryError::Storage(e) => write!(f, "library storage: {e}"),
        }
    }
}

impl Error for HostLibraryError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            HostLibraryError::Storage(e) => Some(e.as_ref()),
        }
    }
}
