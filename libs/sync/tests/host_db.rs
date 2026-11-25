//! Reads a host database built from the desktop schema
//! (`fixtures/host_schema.sql`), written through its real change log triggers.

use rusqlite::{params, Connection, OpenFlags};
use spiral_sync::host_db::{read_changes, read_host_state, read_snapshot, HostDbError};
use spiral_sync::{
    ArtLink, ArtworkInfo, Change, ChangeSet, ChangesResponse, Entity, GenreSetting, LibraryId,
    Playlist, PlaylistTrack, Record, RecordKey, ResnapshotReason, Rev, SyncCursor, Track,
    TrackLyrics,
};

const SCHEMA: &str = include_str!("fixtures/host_schema.sql");
const LIBRARY_ID: &str = "018d0000-0000-7000-8000-00000000f1f0";

const TRACK_A: &str = "018d0000-0000-7000-8000-000000000001";
const TRACK_B: &str = "018d0000-0000-7000-8000-000000000002";
const PLAYLIST_1: &str = "018d0000-0000-7000-8000-0000000000a1";
const PLAYLIST_2: &str = "018d0000-0000-7000-8000-0000000000a2";
const ARTIST_KEY: &str = "ac/dc: live";
const HASH_1: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const HASH_2: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const MBID: &str = "550e8400-e29b-41d4-a716-446655440000";

/// An empty host database with foreign keys on, as the desktop app opens it.
fn empty_host() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    load_schema(&conn);
    conn
}

fn load_schema(conn: &Connection) {
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    let on: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!(on, 1, "the cascade tests need foreign keys on");
    conn.execute_batch(SCHEMA).unwrap();
}

/// Two tracks, two playlists' worth of rows, lyrics, art and a genre setting.
fn seed(conn: &Connection) {
    conn.execute_batch(&format!(
        "INSERT INTO sources (id, name, root_path, created_at)
             VALUES (1, 'Music', '/music', '2024-01-01T00:00:00Z');
         INSERT INTO artwork (hash, mime, width, height, byte_size) VALUES
             ('{HASH_1}', 'image/jpeg', 600, 600, 1234),
             ('{HASH_2}', 'image/png', NULL, NULL, 99);
         INSERT INTO tracks (id, title, artist, album, album_artist, track_number, year, genre,
                             duration_seconds, codec, source_id, rel_path, date_added, rating,
                             play_count, recording_mbid, artist_mbids, album_artist_mbids,
                             file_size, file_mtime_ms)
             VALUES ('{TRACK_B}', 'Back in Black', 'AC/DC', 'Back in Black', 'AC/DC', 6, 1980,
                     'Rock', 255.5, 'flac', 1, 'b.flac', '2024-01-02T00:00:00Z', 4, 9,
                     '{MBID}', '[\"{}\"]', 'not json', 100, 200);
         INSERT INTO tracks (id, title, source_id, rel_path, date_added)
             VALUES ('{TRACK_A}', 'Untitled', 1, 'a.mp3', '2024-01-01T00:00:00Z');
         INSERT INTO playlists (id, title, date_created, last_used_at, position)
             VALUES ('{PLAYLIST_1}', 'Mix', '2024-02-01T00:00:00Z', '2024-02-02T00:00:00Z', 'a0');
         INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES
             ('{PLAYLIST_1}', '{TRACK_B}', 'a1'),
             ('{PLAYLIST_1}', '{TRACK_A}', 'a0');
         INSERT INTO track_lyrics (track_id, format, source, lines_json, plain_text, updated_at)
             VALUES ('{TRACK_B}', 'plain', 'lrclib', '[]', 'Back in black', '2024-03-01');
         INSERT INTO track_artwork (track_id, kind, artwork_hash)
             VALUES ('{TRACK_B}', 'front', '{HASH_1}');
         INSERT INTO artist_artwork (artist_key, kind, artwork_hash)
             VALUES ('{ARTIST_KEY}', 'portrait', '{HASH_2}');
         INSERT INTO playlist_artwork (playlist_id, kind, artwork_hash)
             VALUES ('{PLAYLIST_1}', 'cover', '{HASH_2}');
         INSERT INTO genre_settings (genre_key, background_kind, background_start)
             VALUES ('rock', 'color', '#ff0000');",
        MBID.to_uppercase()
    ))
    .unwrap();
}

/// Rows the seed logs, one rev each.
const SEED_REVS: u64 = 10;

fn seeded_host() -> Connection {
    let conn = empty_host();
    seed(&conn);
    conn
}

fn rev(conn: &Connection) -> Rev {
    read_host_state(conn).unwrap().rev
}

fn cursor(rev: Rev) -> SyncCursor {
    SyncCursor {
        library_id: LibraryId::new(LIBRARY_ID),
        rev,
    }
}

fn changes_since(conn: &Connection, since: Rev) -> ChangeSet {
    match read_changes(conn, &cursor(since)).unwrap() {
        ChangesResponse::Changes(set) => set,
        other => panic!("expected changes, got {other:?}"),
    }
}

/// Each change as (rev, key, upsert or delete).
fn summary(set: &ChangeSet) -> Vec<(u64, RecordKey, &'static str)> {
    set.changes
        .iter()
        .map(|c| {
            let op = match c {
                Change::Upsert { .. } => "upsert",
                Change::Delete { .. } => "delete",
            };
            (c.rev().0, c.key(), op)
        })
        .collect()
}

fn art(hash: &str) -> ArtworkInfo {
    if hash == HASH_1 {
        ArtworkInfo {
            hash: HASH_1.into(),
            mime: "image/jpeg".into(),
            width: Some(600),
            height: Some(600),
            byte_size: 1234,
        }
    } else {
        ArtworkInfo {
            hash: HASH_2.into(),
            mime: "image/png".into(),
            width: None,
            height: None,
            byte_size: 99,
        }
    }
}

fn link(owner: &str, kind: &str, hash: &str) -> ArtLink {
    ArtLink {
        owner: owner.into(),
        kind: kind.into(),
        artwork: art(hash),
    }
}

#[test]
fn a_fresh_host_is_at_rev_zero() {
    let conn = empty_host();
    let host = read_host_state(&conn).unwrap();
    assert_eq!(host.library_id, LibraryId::new(LIBRARY_ID));
    assert_eq!(host.rev, Rev::ZERO);
    assert_eq!(host.oldest_rev, Rev::ZERO);

    let snapshot = read_snapshot(&conn).unwrap();
    assert_eq!(snapshot.rev, Rev::ZERO);
    assert!(snapshot.tracks.is_empty() && snapshot.genre_settings.is_empty());
}

#[test]
fn a_snapshot_holds_every_record_in_key_order() {
    let conn = seeded_host();
    let snapshot = read_snapshot(&conn).unwrap();

    assert_eq!(snapshot.library_id, LibraryId::new(LIBRARY_ID));
    assert_eq!(snapshot.rev, Rev(SEED_REVS));
    assert_eq!(
        snapshot.tracks,
        vec![
            Track {
                id: TRACK_A.into(),
                title: "Untitled".into(),
                artist: None,
                album: None,
                album_artist: None,
                track_number: None,
                total_tracks: None,
                disc_number: None,
                total_discs: None,
                year: None,
                genre: None,
                duration_seconds: None,
                sample_rate: None,
                bitrate: None,
                codec: None,
                date_added: "2024-01-01T00:00:00Z".into(),
                recording_mbid: None,
                release_mbid: None,
                artist_mbids: vec![],
                album_artist_mbids: vec![],
                file_size: None,
                file_mtime_ms: None,
            },
            Track {
                id: TRACK_B.into(),
                title: "Back in Black".into(),
                artist: Some("AC/DC".into()),
                album: Some("Back in Black".into()),
                album_artist: Some("AC/DC".into()),
                track_number: Some(6),
                total_tracks: None,
                disc_number: None,
                total_discs: None,
                year: Some(1980),
                genre: Some("Rock".into()),
                duration_seconds: Some(255.5),
                sample_rate: None,
                bitrate: None,
                codec: Some("flac".into()),
                date_added: "2024-01-02T00:00:00Z".into(),
                recording_mbid: Some(MBID.into()),
                release_mbid: None,
                // Stored uppercase; read as the desktop app reads it.
                artist_mbids: vec![MBID.into()],
                // Invalid JSON reads as no MBIDs.
                album_artist_mbids: vec![],
                file_size: Some(100),
                file_mtime_ms: Some(200),
            },
        ]
    );
    assert_eq!(
        snapshot.playlists,
        vec![Playlist {
            id: PLAYLIST_1.into(),
            title: "Mix".into(),
            description: None,
            date_created: "2024-02-01T00:00:00Z".into(),
            position: "a0".into(),
            image_mode: "generated".into(),
            cover_background: None,
            cover_background_end: None,
            cover_icon: None,
        }]
    );
    // Primary-key order (by track id), not playlist position.
    assert_eq!(
        snapshot.playlist_tracks,
        vec![
            PlaylistTrack {
                playlist_id: PLAYLIST_1.into(),
                track_id: TRACK_A.into(),
                position: "a0".into(),
            },
            PlaylistTrack {
                playlist_id: PLAYLIST_1.into(),
                track_id: TRACK_B.into(),
                position: "a1".into(),
            },
        ]
    );
    assert_eq!(
        snapshot.track_lyrics,
        vec![TrackLyrics {
            track_id: TRACK_B.into(),
            format: "plain".into(),
            source: Some("lrclib".into()),
            lines_json: "[]".into(),
            plain_text: "Back in black".into(),
        }]
    );
    assert_eq!(snapshot.track_artwork, vec![link(TRACK_B, "front", HASH_1)]);
    assert_eq!(
        snapshot.artist_artwork,
        vec![link(ARTIST_KEY, "portrait", HASH_2)]
    );
    assert_eq!(
        snapshot.playlist_artwork,
        vec![link(PLAYLIST_1, "cover", HASH_2)]
    );
    assert_eq!(
        snapshot.genre_settings,
        vec![GenreSetting {
            genre_key: "rock".into(),
            background_kind: Some("color".into()),
            background_start: Some("#ff0000".into()),
            background_end: None,
        }]
    );

    // A client holding the snapshot is up to date.
    assert_eq!(changes_since(&conn, snapshot.rev).changes, vec![]);
}

#[test]
fn changes_from_zero_carry_every_seeded_row() {
    let conn = seeded_host();
    let set = changes_since(&conn, Rev::ZERO);
    assert_eq!((set.since, set.rev), (Rev::ZERO, Rev(SEED_REVS)));
    assert_eq!(set.changes.len() as u64, SEED_REVS);
    assert!(set
        .changes
        .iter()
        .all(|c| matches!(c, Change::Upsert { .. })));
    let revs: Vec<u64> = set.changes.iter().map(|c| c.rev().0).collect();
    assert_eq!(revs, (1..=SEED_REVS).collect::<Vec<_>>());
}

#[test]
fn changes_since_a_rev_hold_current_rows_and_tombstones() {
    let conn = seeded_host();
    let since = rev(&conn);
    conn.execute_batch(&format!(
        "UPDATE tracks SET title = 'Untitled (live)' WHERE id = '{TRACK_A}';
         DELETE FROM genre_settings WHERE genre_key = 'rock';
         DELETE FROM track_lyrics WHERE track_id = '{TRACK_B}';
         UPDATE tracks SET title = 'Untitled (remaster)' WHERE id = '{TRACK_A}';"
    ))
    .unwrap();

    let set = changes_since(&conn, since);
    assert_eq!(set.library_id, LibraryId::new(LIBRARY_ID));
    assert_eq!((set.since, set.rev), (since, Rev(since.0 + 4)));
    assert_eq!(
        summary(&set),
        vec![
            (
                since.0 + 2,
                RecordKey::GenreSetting {
                    genre_key: "rock".into()
                },
                "delete"
            ),
            (
                since.0 + 3,
                RecordKey::TrackLyrics {
                    track_id: TRACK_B.into()
                },
                "delete"
            ),
            // Logged twice; only its latest change is kept, with its current row.
            (
                since.0 + 4,
                RecordKey::Track { id: TRACK_A.into() },
                "upsert"
            ),
        ]
    );
    let Change::Upsert {
        record: Record::Track(track),
        ..
    } = &set.changes[2]
    else {
        panic!("expected a track upsert");
    };
    assert_eq!(track.title, "Untitled (remaster)");

    // Changes since the latest of them are none.
    assert_eq!(changes_since(&conn, set.rev).changes, vec![]);
}

#[test]
fn a_playlist_delete_cascades_to_its_entries_and_art() {
    let conn = seeded_host();
    let since = rev(&conn);
    conn.execute("DELETE FROM playlists WHERE id = ?1", [PLAYLIST_1])
        .unwrap();

    let set = changes_since(&conn, since);
    let mut keys: Vec<(RecordKey, &str)> = summary(&set)
        .into_iter()
        .map(|(_, key, op)| (key, op))
        .collect();
    keys.sort_by_key(|(key, _)| format!("{}:{}", key.entity(), key.log_id()));
    assert_eq!(
        keys,
        vec![
            (
                RecordKey::Playlist {
                    id: PLAYLIST_1.into()
                },
                "delete"
            ),
            (
                RecordKey::PlaylistArtwork {
                    owner: PLAYLIST_1.into(),
                    kind: "cover".into()
                },
                "delete"
            ),
            (
                RecordKey::PlaylistTrack {
                    playlist_id: PLAYLIST_1.into(),
                    track_id: TRACK_A.into()
                },
                "delete"
            ),
            (
                RecordKey::PlaylistTrack {
                    playlist_id: PLAYLIST_1.into(),
                    track_id: TRACK_B.into()
                },
                "delete"
            ),
        ]
    );
    assert_eq!(set.rev, Rev(since.0 + 4));
    assert!(read_snapshot(&conn).unwrap().playlist_tracks.is_empty());
}

#[test]
fn a_child_can_carry_a_lower_rev_than_its_parent() {
    let conn = seeded_host();
    let since = rev(&conn);
    conn.execute_batch(&format!(
        "INSERT INTO playlists (id, title, date_created, last_used_at, position)
             VALUES ('{PLAYLIST_2}', 'New', '2024-04-01T00:00:00Z', '2024-04-01T00:00:00Z', 'a1');
         INSERT INTO playlist_tracks (playlist_id, track_id, position)
             VALUES ('{PLAYLIST_2}', '{TRACK_A}', 'a0');
         UPDATE playlists SET title = 'Renamed' WHERE id = '{PLAYLIST_2}';"
    ))
    .unwrap();

    let set = changes_since(&conn, since);
    assert_eq!(
        summary(&set),
        vec![
            (
                since.0 + 2,
                RecordKey::PlaylistTrack {
                    playlist_id: PLAYLIST_2.into(),
                    track_id: TRACK_A.into()
                },
                "upsert"
            ),
            (
                since.0 + 3,
                RecordKey::Playlist {
                    id: PLAYLIST_2.into()
                },
                "upsert"
            ),
        ]
    );
    let Change::Upsert {
        record: Record::Playlist(playlist),
        ..
    } = &set.changes[1]
    else {
        panic!("expected a playlist upsert");
    };
    assert_eq!(playlist.title, "Renamed");
}

#[test]
fn an_artist_key_with_colons_keeps_them() {
    let conn = seeded_host();
    let since = rev(&conn);
    conn.execute(
        "UPDATE artist_artwork SET artwork_hash = ?1 WHERE artist_key = ?2",
        params![HASH_1, ARTIST_KEY],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO artist_artwork (artist_key, kind, artwork_hash) VALUES ('a:b:', 'portrait', ?1)",
        [HASH_2],
    )
    .unwrap();
    conn.execute("DELETE FROM artist_artwork WHERE artist_key = 'a:b:'", [])
        .unwrap();

    let set = changes_since(&conn, since);
    assert_eq!(
        set.changes,
        vec![
            Change::Upsert {
                rev: Rev(since.0 + 1),
                record: Record::ArtistArtwork(link(ARTIST_KEY, "portrait", HASH_1)),
            },
            Change::Delete {
                rev: Rev(since.0 + 3),
                key: RecordKey::ArtistArtwork {
                    owner: "a:b:".into(),
                    kind: "portrait".into()
                },
            },
        ]
    );
}

#[test]
fn an_up_to_date_client_gets_no_changes() {
    let conn = seeded_host();
    let host = rev(&conn);
    assert_eq!(
        read_changes(&conn, &cursor(host)).unwrap(),
        ChangesResponse::Changes(ChangeSet {
            library_id: LibraryId::new(LIBRARY_ID),
            since: host,
            rev: host,
            changes: vec![],
        })
    );
}

#[test]
fn a_client_ahead_of_the_host_resnapshots() {
    let conn = seeded_host();
    let host = read_host_state(&conn).unwrap();
    assert_eq!(
        read_changes(&conn, &cursor(Rev(host.rev.0 + 1))).unwrap(),
        ChangesResponse::Resnapshot {
            reason: ResnapshotReason::ClientAhead,
            host,
        }
    );
}

#[test]
fn a_client_of_another_library_resnapshots() {
    let conn = seeded_host();
    let host = read_host_state(&conn).unwrap();
    let other = SyncCursor {
        library_id: LibraryId::new("018d0000-0000-7000-8000-00000000beef"),
        rev: Rev(1),
    };
    assert_eq!(
        read_changes(&conn, &other).unwrap(),
        ChangesResponse::Resnapshot {
            reason: ResnapshotReason::DifferentLibrary,
            host,
        }
    );
}

#[test]
fn an_upsert_whose_row_is_gone_is_an_error() {
    let conn = seeded_host();
    // Delete without logging it, so the log still says upsert.
    conn.execute_batch(
        "DROP TRIGGER change_log_genre_settings_delete;
         DELETE FROM genre_settings WHERE genre_key = 'rock';",
    )
    .unwrap();
    match read_changes(&conn, &cursor(Rev::ZERO)) {
        Err(HostDbError::MissingRow { entity, id }) => {
            assert_eq!((entity, id.as_str()), (Entity::GenreSetting, "rock"));
        }
        other => panic!("expected a missing row, got {other:?}"),
    }
}

#[test]
fn a_link_to_an_unregistered_image_is_an_error() {
    let conn = seeded_host();
    conn.execute_batch(&format!(
        "PRAGMA foreign_keys = OFF;
         INSERT INTO track_artwork (track_id, kind, artwork_hash)
             VALUES ('{TRACK_A}', 'front', 'feed');
         PRAGMA foreign_keys = ON;"
    ))
    .unwrap();
    let err = read_snapshot(&conn).unwrap_err();
    assert!(
        matches!(&err, HostDbError::MissingArtwork { hash, .. } if hash == "feed"),
        "{err:?}"
    );
    assert!(err.to_string().contains("feed"), "{err}");
}

#[test]
fn a_read_only_connection_can_serve_snapshots_and_changes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("Library.db");
    {
        let conn = Connection::open(&path).unwrap();
        load_schema(&conn);
        seed(&conn);
    }

    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert!(
        conn.execute("DELETE FROM genre_settings", []).is_err(),
        "the connection must be read-only"
    );
    let snapshot = read_snapshot(&conn).unwrap();
    assert_eq!(snapshot.rev, Rev(SEED_REVS));
    assert_eq!(snapshot.tracks.len(), 2);
    assert_eq!(changes_since(&conn, Rev(SEED_REVS - 1)).changes.len(), 1);
    assert_eq!(
        read_changes(&conn, &cursor(Rev(SEED_REVS))).unwrap(),
        ChangesResponse::Changes(ChangeSet {
            library_id: LibraryId::new(LIBRARY_ID),
            since: Rev(SEED_REVS),
            rev: Rev(SEED_REVS),
            changes: vec![],
        })
    );
}
