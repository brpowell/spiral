//! Spiral's host HTTP API: what a library host serves to its clients.
//!
//! [`router`] builds the API over a [`HostLibrary`] (where the data comes
//! from) and an [`Authenticator`] (who may ask). Every route, unknown paths
//! included, requires a bearer token, so an unauthenticated request gets 401
//! before it can learn which paths exist.
//!
//! The crate never binds an address. A host hands [`serve`] any
//! [`axum::serve::Listener`] it opened, or hands [`serve_connection`] a single
//! stream it already connected.
//!
//! Routes, all under `/v1`. Sync routes (`/v1/sync/*`) answer JSON and are how
//! a client mirrors the catalog. Content routes serve files to any client.
//!
//! - `GET /v1/sync/state`: the [`HostState`](spiral_sync::HostState).
//! - `GET /v1/sync/snapshot`: the [`Snapshot`](spiral_sync::Snapshot).
//! - `GET /v1/sync/changes?library_id=&since=`: the
//!   [`ChangesResponse`](spiral_sync::ChangesResponse) for that cursor.
//! - `GET /v1/tracks/{id}/audio`: the track's audio file, with range requests.
//! - `GET /v1/artwork/{hash}?max=N`: an image, the original or resized to
//!   120, 300, 600 or 1200 px on the longer side.

mod artwork;
mod auth;
mod library;
mod routes;
mod serve;
mod sqlite;

pub use auth::{AuthFuture, AuthedDevice, Authenticator, DevTokenAuth};
pub use library::{is_artwork_hash, ArtworkOriginal, HostFuture, HostLibrary, HostLibraryError};
pub use routes::{router, HostApi};
pub use serve::{serve, serve_connection};
pub use sqlite::SqliteHostLibrary;
