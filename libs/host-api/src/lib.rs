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
//! Routes, all under `/v1` and answering JSON:
//!
//! - `GET /v1/library`: the [`HostState`](spiral_sync::HostState).
//! - `GET /v1/snapshot`: the [`Snapshot`](spiral_sync::Snapshot).
//! - `GET /v1/changes?library_id=&since=`: the
//!   [`ChangesResponse`](spiral_sync::ChangesResponse) for that cursor.

mod auth;
mod library;
mod routes;
mod serve;
mod sqlite;

pub use auth::{AuthFuture, AuthedDevice, Authenticator, DevTokenAuth};
pub use library::{HostFuture, HostLibrary, HostLibraryError};
pub use routes::{router, HostApi};
pub use serve::{serve, serve_connection};
pub use sqlite::SqliteHostLibrary;
