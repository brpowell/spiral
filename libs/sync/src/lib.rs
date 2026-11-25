//! Spiral library sync, shared by every host and client.
//!
//! A library host owns the catalog. It counts every catalog change with a
//! per-library [`Rev`] and keeps a change log holding each entity's latest
//! change. A client syncs by taking a [`Snapshot`] once, then asking for the
//! changes since the rev it last applied. [`plan_sync`] decides which of the
//! two a client needs; the host runs it on every changes request too.
//!
//! This crate holds plain data and logic only: no transport, UI or runtime.
//! Requests and responses are serde types, so any transport can carry them.
//! The `host` feature adds [`host_db`], which reads them from a host's SQLite
//! library; clients leave it off.

#[cfg(feature = "host")]
pub mod host_db;
mod ids;
mod plan;
mod protocol;
mod records;

pub use ids::{LibraryId, Rev};
pub use plan::{plan_sync, ResnapshotReason, SyncAction};
pub use protocol::{Change, ChangeSet, ChangesResponse, HostState, Snapshot, SyncCursor};
pub use records::{
    ArtLink, ArtworkInfo, Entity, GenreSetting, KeyError, Playlist, PlaylistTrack, Record,
    RecordKey, Track, TrackLyrics,
};
