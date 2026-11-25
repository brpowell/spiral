//! Where the API's data comes from.

use spiral_sync::{ChangesResponse, HostState, Snapshot, SyncCursor};
use std::error::Error;
use std::fmt;
use std::future::Future;
use std::path::PathBuf;
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
/// Methods past the catalog reads have default bodies that return
/// [`HostLibraryError::Unsupported`], which the API answers with 501. An
/// implementation that doesn't serve files keeps compiling, and a client can
/// tell "this host can't" from "this file isn't there". Later additions follow
/// the same pattern: opening audio for a transcoding profile
/// (`open_audio(track, profile)`) next to [`track_file`](Self::track_file),
/// and a hook that writes a client's rating back.
///
/// Finding files is the library's job: it decides which paths a track or an
/// image may be served from. Serving them (ranges, resizing, caching) is the
/// API's.
pub trait HostLibrary: Send + Sync + 'static {
    /// The library id and where its change feed stands.
    fn host_state(&self) -> HostFuture<'_, HostState>;

    /// The whole catalog at the current rev.
    fn snapshot(&self) -> HostFuture<'_, Snapshot>;

    /// The changes after `cursor`, or that the client must resnapshot.
    fn changes<'a>(&'a self, cursor: &'a SyncCursor) -> HostFuture<'a, ChangesResponse>;

    /// The absolute path of a track's audio file, or `None` when the track is
    /// unknown, its file is missing, or the file isn't one the library will
    /// serve (outside its source's root, for one). The API answers all of
    /// those with the same 404.
    fn track_file<'a>(&'a self, track_id: &'a str) -> HostFuture<'a, Option<PathBuf>> {
        let _ = track_id;
        Box::pin(async { Err(HostLibraryError::Unsupported) })
    }

    /// An intact copy of the image with this content hash, or `None` when
    /// there is none. The API only calls this with a valid hash (see
    /// [`is_artwork_hash`]).
    fn artwork_original<'a>(&'a self, hash: &'a str) -> HostFuture<'a, Option<ArtworkOriginal>> {
        let _ = hash;
        Box::pin(async { Err(HostLibraryError::Unsupported) })
    }
}

/// An image's original file and what the library recorded about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtworkOriginal {
    /// Absolute path of an intact copy.
    pub path: PathBuf,
    /// `image/jpeg`, `image/png`, ...
    pub mime: String,
    /// Pixel size, when the library knows it.
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub byte_size: u64,
}

/// Artwork is addressed by the SHA-256 of its bytes: 64 lowercase hex digits.
pub fn is_artwork_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Why a [`HostLibrary`] couldn't answer.
#[derive(Debug)]
#[non_exhaustive]
pub enum HostLibraryError {
    /// The library's storage failed. The API answers 500 and logs the
    /// details; clients never see them.
    Storage(Box<dyn Error + Send + Sync>),
    /// This library doesn't implement the method. The API answers 501.
    Unsupported,
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
            HostLibraryError::Unsupported => f.write_str("not supported by this library"),
        }
    }
}

impl Error for HostLibraryError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            HostLibraryError::Storage(e) => Some(e.as_ref()),
            HostLibraryError::Unsupported => None,
        }
    }
}
