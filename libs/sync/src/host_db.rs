//! Reads snapshots and change sets from a host library's SQLite database
//! (the desktop app's `Library.db`). Behind the `host` feature.
//!
//! The schema belongs to the desktop app (`db_migrations.rs`). Its triggers
//! keep `library_meta.rev` and `change_log` current; this module only reads.
//! Every function works on a read-only connection, and each reads in one
//! transaction, so the rev it reports matches the rows it returns. Inside a
//! caller's transaction the read nests as a savepoint.
//!
//! The desktop database uses SQLite's rollback journal, so while a read is
//! open the app's writes wait for it, and a read waits for a write in
//! progress. rusqlite gives every connection a 5 s busy timeout, which covers
//! both. A host that lowers it on its connection can get `SQLITE_BUSY`.
//!
//! `tests/fixtures/host_schema.sql` is the desktop schema these readers are
//! tested against. A desktop test fails when the two drift apart.

use crate::ids::{LibraryId, Rev};
use crate::plan::{plan_sync, SyncAction};
use crate::protocol::{Change, ChangeSet, ChangesResponse, HostState, Snapshot, SyncCursor};
use crate::records::{
    ArtLink, ArtworkInfo, Entity, GenreSetting, KeyError, Playlist, PlaylistTrack, Record,
    RecordKey, Track, TrackLyrics,
};
use rusqlite::{params, Connection, Params, Row};
use std::fmt;

/// Why a host database couldn't be read.
#[derive(Debug)]
pub enum HostDbError {
    Sqlite(rusqlite::Error),
    /// A change log row whose entity or id can't be read.
    Key(KeyError),
    /// A change log row whose `op` is neither `upsert` nor `delete`.
    UnknownOp {
        rev: i64,
        op: String,
    },
    /// The change log says an entity was upserted, but its row is gone.
    MissingRow {
        entity: Entity,
        id: String,
    },
    /// An art link names an image the `artwork` registry doesn't have.
    MissingArtwork {
        key: RecordKey,
        hash: String,
    },
    /// `library_meta.rev` or a `change_log.rev` is below zero.
    NegativeRev(i64),
    /// The database's `user_version` is below [`MIN_SCHEMA_VERSION`]: not a
    /// Spiral library, or one from before sync.
    UnsupportedSchema {
        version: i64,
    },
}

/// The oldest desktop schema these readers understand: version 10, the first
/// with the artwork registry and every logged table.
pub const MIN_SCHEMA_VERSION: i64 = 10;

impl fmt::Display for HostDbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HostDbError::Sqlite(e) => write!(f, "host database: {e}"),
            HostDbError::Key(e) => e.fmt(f),
            HostDbError::UnknownOp { rev, op } => {
                write!(f, "change log rev {rev} has unknown op {op:?}")
            }
            HostDbError::MissingRow { entity, id } => {
                write!(
                    f,
                    "change log upserts {entity} {id:?} but its row is missing"
                )
            }
            HostDbError::MissingArtwork { key, hash } => write!(
                f,
                "{} {:?} links artwork {hash} that is not registered",
                key.entity(),
                key.log_id()
            ),
            HostDbError::NegativeRev(rev) => write!(f, "negative rev {rev} in host database"),
            HostDbError::UnsupportedSchema { version } => write!(
                f,
                "host database schema version {version} is not supported; \
                 it needs version {MIN_SCHEMA_VERSION} or newer"
            ),
        }
    }
}

impl std::error::Error for HostDbError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            HostDbError::Sqlite(e) => Some(e),
            HostDbError::Key(e) => Some(e),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for HostDbError {
    fn from(e: rusqlite::Error) -> Self {
        HostDbError::Sqlite(e)
    }
}

impl From<KeyError> for HostDbError {
    fn from(e: KeyError) -> Self {
        HostDbError::Key(e)
    }
}

type Result<T> = std::result::Result<T, HostDbError>;

/// The host's library id and latest rev. The log is never compacted, so
/// `oldest_rev` is 0.
pub fn read_host_state(conn: &Connection) -> Result<HostState> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < MIN_SCHEMA_VERSION {
        return Err(HostDbError::UnsupportedSchema { version });
    }
    let (library_id, rev): (String, i64) = conn.query_row(
        "SELECT library_id, rev FROM library_meta WHERE id = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(HostState {
        library_id: LibraryId::new(library_id),
        rev: to_rev(rev)?,
        oldest_rev: Rev::ZERO,
    })
}

/// The whole catalog at the host's current rev, each table in primary-key
/// order.
pub fn read_snapshot(conn: &Connection) -> Result<Snapshot> {
    let read = Read::begin(conn)?;
    let tx = read.conn;
    let host = read_host_state(tx)?;
    let snapshot = Snapshot {
        library_id: host.library_id,
        rev: host.rev,
        tracks: read_all(tx, &TRACKS, track)?,
        playlists: read_all(tx, &PLAYLISTS, playlist)?,
        playlist_tracks: read_all(tx, &PLAYLIST_TRACKS, playlist_track)?,
        track_lyrics: read_all(tx, &TRACK_LYRICS, track_lyrics)?,
        track_artwork: read_all(tx, &TRACK_ARTWORK, track_art)?,
        artist_artwork: read_all(tx, &ARTIST_ARTWORK, artist_art)?,
        playlist_artwork: read_all(tx, &PLAYLIST_ARTWORK, playlist_art)?,
        genre_settings: read_all(tx, &GENRE_SETTINGS, genre_setting)?,
    };
    read.finish()?;
    Ok(snapshot)
}

/// What `client` needs to catch up: every change after its rev, or that it
/// must take a snapshot ([`plan_sync`] decides). Each upsert carries the
/// entity's current row.
pub fn read_changes(conn: &Connection, client: &SyncCursor) -> Result<ChangesResponse> {
    let read = Read::begin(conn)?;
    let tx = read.conn;
    let host = read_host_state(tx)?;
    let response = match plan_sync(Some(client), &host) {
        SyncAction::UpToDate => ChangesResponse::Changes(ChangeSet {
            library_id: host.library_id,
            since: host.rev,
            rev: host.rev,
            changes: Vec::new(),
        }),
        SyncAction::FetchChanges { since } => ChangesResponse::Changes(ChangeSet {
            changes: read_log(tx, since)?,
            library_id: host.library_id,
            since,
            rev: host.rev,
        }),
        SyncAction::Resnapshot { reason } => ChangesResponse::Resnapshot { reason, host },
    };
    read.finish()?;
    Ok(response)
}

/// One consistent read. `SAVEPOINT` starts a deferred transaction on an idle
/// connection and nests inside a caller's, where `BEGIN` would fail.
struct Read<'c> {
    conn: &'c Connection,
    done: bool,
}

impl<'c> Read<'c> {
    const BEGIN: &'static str = "SAVEPOINT spiral_sync_read";

    fn begin(conn: &'c Connection) -> Result<Self> {
        conn.execute_batch(Self::BEGIN)?;
        Ok(Read { conn, done: false })
    }

    fn finish(mut self) -> Result<()> {
        self.done = true;
        self.conn.execute_batch("RELEASE spiral_sync_read")?;
        Ok(())
    }
}

impl Drop for Read<'_> {
    fn drop(&mut self) {
        if !self.done {
            // Nothing was written; this only ends the read.
            let _ = self
                .conn
                .execute_batch("ROLLBACK TO spiral_sync_read; RELEASE spiral_sync_read");
        }
    }
}

fn read_log(conn: &Connection, since: Rev) -> Result<Vec<Change>> {
    // `since` is below the host's rev, which came from an i64.
    let since = i64::try_from(since.0).unwrap_or(i64::MAX);
    let mut stmt = conn
        .prepare("SELECT rev, entity, entity_id, op FROM change_log WHERE rev > ?1 ORDER BY rev")?;
    let mut rows = stmt.query([since])?;
    let mut changes = Vec::new();
    while let Some(row) = rows.next()? {
        let raw_rev: i64 = row.get(0)?;
        let rev = to_rev(raw_rev)?;
        let entity: String = row.get(1)?;
        let entity_id: String = row.get(2)?;
        let op: String = row.get(3)?;
        let key = RecordKey::from_log(&entity, &entity_id)?;
        changes.push(match op.as_str() {
            "upsert" => Change::Upsert {
                rev,
                record: read_record(conn, &key)?.ok_or_else(|| HostDbError::MissingRow {
                    entity: key.entity(),
                    id: entity_id,
                })?,
            },
            "delete" => Change::Delete { rev, key },
            _ => return Err(HostDbError::UnknownOp { rev: raw_rev, op }),
        });
    }
    Ok(changes)
}

/// The current row for `key`, or `None` when there is none.
fn read_record(conn: &Connection, key: &RecordKey) -> Result<Option<Record>> {
    Ok(match key {
        RecordKey::Track { id } => read_one(conn, &TRACKS, [id], track)?.map(Record::Track),
        RecordKey::Playlist { id } => {
            read_one(conn, &PLAYLISTS, [id], playlist)?.map(Record::Playlist)
        }
        RecordKey::PlaylistTrack {
            playlist_id,
            track_id,
        } => read_one(
            conn,
            &PLAYLIST_TRACKS,
            params![playlist_id, track_id],
            playlist_track,
        )?
        .map(Record::PlaylistTrack),
        RecordKey::TrackLyrics { track_id } => {
            read_one(conn, &TRACK_LYRICS, [track_id], track_lyrics)?.map(Record::TrackLyrics)
        }
        RecordKey::TrackArtwork { owner, kind } => {
            read_one(conn, &TRACK_ARTWORK, params![owner, kind], track_art)?
                .map(Record::TrackArtwork)
        }
        RecordKey::ArtistArtwork { owner, kind } => {
            read_one(conn, &ARTIST_ARTWORK, params![owner, kind], artist_art)?
                .map(Record::ArtistArtwork)
        }
        RecordKey::PlaylistArtwork { owner, kind } => {
            read_one(conn, &PLAYLIST_ARTWORK, params![owner, kind], playlist_art)?
                .map(Record::PlaylistArtwork)
        }
        RecordKey::GenreSetting { genre_key } => {
            read_one(conn, &GENRE_SETTINGS, [genre_key], genre_setting)?.map(Record::GenreSetting)
        }
    })
}

/// How to read one logged table: its columns, the `WHERE` that picks one row
/// by primary key, and its primary-key order.
struct Table {
    select: &'static str,
    by_key: &'static str,
    order: &'static str,
}

const TRACKS: Table = Table {
    select: "SELECT id, title, artist, album, album_artist, track_number, total_tracks,
                    disc_number, total_discs, year, genre, duration_seconds, sample_rate,
                    bitrate, codec, date_added, recording_mbid, release_mbid, artist_mbids,
                    album_artist_mbids, file_size, file_mtime_ms
             FROM tracks",
    by_key: "id = ?1",
    order: "id",
};

const PLAYLISTS: Table = Table {
    select: "SELECT id, title, description, date_created, position, image_mode,
                    cover_background, cover_background_end, cover_icon
             FROM playlists",
    by_key: "id = ?1",
    order: "id",
};

const PLAYLIST_TRACKS: Table = Table {
    select: "SELECT playlist_id, track_id, position FROM playlist_tracks",
    by_key: "playlist_id = ?1 AND track_id = ?2",
    order: "playlist_id, track_id",
};

const TRACK_LYRICS: Table = Table {
    select: "SELECT track_id, format, source, lines_json, plain_text FROM track_lyrics",
    by_key: "track_id = ?1",
    order: "track_id",
};

// Art links left-join the registry, so a link to an unregistered image is an
// error rather than a row that silently goes missing.
const TRACK_ARTWORK: Table = Table {
    select: "SELECT l.track_id, l.kind, l.artwork_hash, a.mime, a.width, a.height, a.byte_size
             FROM track_artwork l LEFT JOIN artwork a ON a.hash = l.artwork_hash",
    by_key: "l.track_id = ?1 AND l.kind = ?2",
    order: "l.track_id, l.kind",
};

const ARTIST_ARTWORK: Table = Table {
    select: "SELECT l.artist_key, l.kind, l.artwork_hash, a.mime, a.width, a.height, a.byte_size
             FROM artist_artwork l LEFT JOIN artwork a ON a.hash = l.artwork_hash",
    by_key: "l.artist_key = ?1 AND l.kind = ?2",
    order: "l.artist_key, l.kind",
};

const PLAYLIST_ARTWORK: Table = Table {
    select: "SELECT l.playlist_id, l.kind, l.artwork_hash, a.mime, a.width, a.height, a.byte_size
             FROM playlist_artwork l LEFT JOIN artwork a ON a.hash = l.artwork_hash",
    by_key: "l.playlist_id = ?1 AND l.kind = ?2",
    order: "l.playlist_id, l.kind",
};

const GENRE_SETTINGS: Table = Table {
    select: "SELECT genre_key, background_kind, background_start, background_end
             FROM genre_settings",
    by_key: "genre_key = ?1",
    order: "genre_key",
};

fn read_all<T>(
    conn: &Connection,
    table: &Table,
    map: impl Fn(&Row) -> Result<T>,
) -> Result<Vec<T>> {
    let mut stmt = conn.prepare(&format!("{} ORDER BY {}", table.select, table.order))?;
    let mut rows = stmt.query([])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push(map(row)?);
    }
    Ok(out)
}

fn read_one<T>(
    conn: &Connection,
    table: &Table,
    key: impl Params,
    map: impl Fn(&Row) -> Result<T>,
) -> Result<Option<T>> {
    let mut stmt = conn.prepare_cached(&format!("{} WHERE {}", table.select, table.by_key))?;
    let mut rows = stmt.query(key)?;
    rows.next()?.map(map).transpose()
}

fn track(r: &Row) -> Result<Track> {
    Ok(Track {
        id: r.get(0)?,
        title: r.get(1)?,
        artist: r.get(2)?,
        album: r.get(3)?,
        album_artist: r.get(4)?,
        track_number: r.get(5)?,
        total_tracks: r.get(6)?,
        disc_number: r.get(7)?,
        total_discs: r.get(8)?,
        year: r.get(9)?,
        genre: r.get(10)?,
        duration_seconds: r.get(11)?,
        sample_rate: r.get(12)?,
        bitrate: r.get(13)?,
        codec: r.get(14)?,
        date_added: r.get(15)?,
        recording_mbid: r.get(16)?,
        release_mbid: r.get(17)?,
        artist_mbids: mbid_list(r.get::<_, Option<String>>(18)?.as_deref()),
        album_artist_mbids: mbid_list(r.get::<_, Option<String>>(19)?.as_deref()),
        file_size: r.get(20)?,
        file_mtime_ms: r.get(21)?,
    })
}

fn playlist(r: &Row) -> Result<Playlist> {
    Ok(Playlist {
        id: r.get(0)?,
        title: r.get(1)?,
        description: r.get(2)?,
        date_created: r.get(3)?,
        position: r.get(4)?,
        image_mode: r.get(5)?,
        cover_background: r.get(6)?,
        cover_background_end: r.get(7)?,
        cover_icon: r.get(8)?,
    })
}

fn playlist_track(r: &Row) -> Result<PlaylistTrack> {
    Ok(PlaylistTrack {
        playlist_id: r.get(0)?,
        track_id: r.get(1)?,
        position: r.get(2)?,
    })
}

fn track_lyrics(r: &Row) -> Result<TrackLyrics> {
    Ok(TrackLyrics {
        track_id: r.get(0)?,
        format: r.get(1)?,
        source: r.get(2)?,
        lines_json: r.get(3)?,
        plain_text: r.get(4)?,
    })
}

fn track_art(r: &Row) -> Result<ArtLink> {
    art_link(r, |owner, kind| RecordKey::TrackArtwork { owner, kind })
}

fn artist_art(r: &Row) -> Result<ArtLink> {
    art_link(r, |owner, kind| RecordKey::ArtistArtwork { owner, kind })
}

fn playlist_art(r: &Row) -> Result<ArtLink> {
    art_link(r, |owner, kind| RecordKey::PlaylistArtwork { owner, kind })
}

/// An art link row. `key` names the link in the error when its image isn't
/// registered.
fn art_link(r: &Row, key: fn(String, String) -> RecordKey) -> Result<ArtLink> {
    let owner: String = r.get(0)?;
    let kind: String = r.get(1)?;
    let hash: String = r.get(2)?;
    let Some(mime) = r.get::<_, Option<String>>(3)? else {
        return Err(HostDbError::MissingArtwork {
            key: key(owner, kind),
            hash,
        });
    };
    Ok(ArtLink {
        owner,
        kind,
        artwork: ArtworkInfo {
            hash,
            mime,
            width: r.get(4)?,
            height: r.get(5)?,
            byte_size: r.get(6)?,
        },
    })
}

fn genre_setting(r: &Row) -> Result<GenreSetting> {
    Ok(GenreSetting {
        genre_key: r.get(0)?,
        background_kind: r.get(1)?,
        background_start: r.get(2)?,
        background_end: r.get(3)?,
    })
}

fn to_rev(rev: i64) -> Result<Rev> {
    u64::try_from(rev)
        .map(Rev)
        .map_err(|_| HostDbError::NegativeRev(rev))
}

/// Reads an MBID list column as the desktop app does (`mbid::parse_mbid_list`):
/// a JSON array of strings, each trimmed and lowercased, empty ones dropped.
/// NULL, empty or invalid text is an empty list.
fn mbid_list(raw: Option<&str>) -> Vec<String> {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(raw)
        .unwrap_or_default()
        .into_iter()
        .map(|id| id.trim().to_ascii_lowercase())
        .filter(|id| !id.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mbid_lists_read_like_the_desktop_app() {
        assert!(mbid_list(None).is_empty());
        assert!(mbid_list(Some("")).is_empty());
        assert!(mbid_list(Some("  ")).is_empty());
        assert!(mbid_list(Some("[]")).is_empty());
        assert!(mbid_list(Some("not-json")).is_empty());
        assert!(mbid_list(Some(r#"{"a": 1}"#)).is_empty());
        assert_eq!(
            mbid_list(Some(
                r#"[" 550E8400-E29B-41D4-A716-446655440000 ", "", "b"]"#
            )),
            vec!["550e8400-e29b-41d4-a716-446655440000", "b"]
        );
    }

    #[test]
    fn negative_revs_are_errors() {
        assert_eq!(to_rev(7).unwrap(), Rev(7));
        assert!(matches!(to_rev(-1), Err(HostDbError::NegativeRev(-1))));
    }
}
