//! What hosts and clients exchange.

use crate::ids::{LibraryId, Rev};
use crate::plan::ResnapshotReason;
use crate::records::{
    ArtLink, GenreSetting, Playlist, PlaylistTrack, Record, RecordKey, Track, TrackLyrics,
};
use serde::{Deserialize, Serialize};

/// Where a host library's change feed stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostState {
    pub library_id: LibraryId,
    /// The latest logged change.
    pub rev: Rev,
    /// The lowest `since` the host can still answer with a complete change
    /// set. 0 while the log is never compacted.
    pub oldest_rev: Rev,
}

/// What a client has applied: everything from one library up to `rev`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncCursor {
    pub library_id: LibraryId,
    pub rev: Rev,
}

/// The whole catalog at one rev. A client replaces its copy with it and keeps
/// `library_id` and `rev` as its cursor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    pub library_id: LibraryId,
    pub rev: Rev,
    pub tracks: Vec<Track>,
    pub playlists: Vec<Playlist>,
    pub playlist_tracks: Vec<PlaylistTrack>,
    pub track_lyrics: Vec<TrackLyrics>,
    pub track_artwork: Vec<ArtLink>,
    pub artist_artwork: Vec<ArtLink>,
    pub playlist_artwork: Vec<ArtLink>,
    pub genre_settings: Vec<GenreSetting>,
}

impl Snapshot {
    /// The snapshot as a cursor to sync on from.
    pub fn cursor(&self) -> SyncCursor {
        SyncCursor {
            library_id: self.library_id.clone(),
            rev: self.rev,
        }
    }
}

/// Every entity that changed after `since`, up to and including `rev`, each
/// with its latest change only.
///
/// The host keeps only each entity's latest rev, so changes are not a replay
/// of history: a child (a playlist entry) can carry a lower rev than its
/// parent (the playlist). A client applies the whole set in one transaction
/// and then moves its cursor to `rev`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChangeSet {
    pub library_id: LibraryId,
    pub since: Rev,
    pub rev: Rev,
    pub changes: Vec<Change>,
}

impl ChangeSet {
    /// The cursor a client holds once it has applied this set.
    pub fn cursor(&self) -> SyncCursor {
        SyncCursor {
            library_id: self.library_id.clone(),
            rev: self.rev,
        }
    }
}

/// One entity's latest change: its current record, or that it is gone.
// Not boxed, for the same reason as `Record`.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Change {
    Upsert { rev: Rev, record: Record },
    Delete { rev: Rev, key: RecordKey },
}

impl Change {
    pub fn rev(&self) -> Rev {
        match self {
            Change::Upsert { rev, .. } | Change::Delete { rev, .. } => *rev,
        }
    }

    pub fn key(&self) -> RecordKey {
        match self {
            Change::Upsert { record, .. } => record.key(),
            Change::Delete { key, .. } => key.clone(),
        }
    }
}

/// A host's answer to "changes since N": the changes, or that the client must
/// take a snapshot instead.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChangesResponse {
    Changes(ChangeSet),
    Resnapshot {
        reason: ResnapshotReason,
        host: HostState,
    },
}
