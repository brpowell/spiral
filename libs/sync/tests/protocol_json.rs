//! The JSON shape of the protocol, pinned. Clients in other languages read
//! these documents, so a change here is a protocol change.

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use spiral_sync::*;

/// `value` serializes to `expected` and reads back as itself.
fn pins<T>(value: &T, expected: Value)
where
    T: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug,
{
    assert_eq!(serde_json::to_value(value).unwrap(), expected);
    let back: T = serde_json::from_value(expected).unwrap();
    assert_eq!(&back, value);
}

fn track() -> Track {
    Track {
        id: "0192f0c4-0000-7000-8000-000000000001".into(),
        title: "Song".into(),
        artist: Some("Artist".into()),
        album: Some("Album".into()),
        album_artist: None,
        track_number: Some(3),
        total_tracks: Some(12),
        disc_number: None,
        total_discs: None,
        year: Some(1999),
        genre: Some("Rock".into()),
        duration_seconds: Some(201.5),
        sample_rate: Some(44100),
        bitrate: Some(320),
        codec: Some("mp3".into()),
        date_added: "2026-11-01T12:00:00+00:00".into(),
        recording_mbid: None,
        release_mbid: None,
        artist_mbids: vec!["a-mbid".into()],
        album_artist_mbids: vec![],
        file_size: Some(8_000_000),
        file_mtime_ms: Some(1_700_000_000_000),
    }
}

fn art_link(owner: &str, kind: &str) -> ArtLink {
    ArtLink {
        owner: owner.into(),
        kind: kind.into(),
        artwork: ArtworkInfo {
            hash: "ab12".into(),
            mime: "image/jpeg".into(),
            width: Some(600),
            height: None,
            byte_size: 51_200,
        },
    }
}

#[test]
fn host_state_and_cursor() {
    pins(
        &HostState {
            library_id: LibraryId::new("lib"),
            rev: Rev(7),
            oldest_rev: Rev::ZERO,
        },
        json!({ "library_id": "lib", "rev": 7, "oldest_rev": 0 }),
    );
    pins(
        &SyncCursor {
            library_id: LibraryId::new("lib"),
            rev: Rev(7),
        },
        json!({ "library_id": "lib", "rev": 7 }),
    );
}

#[test]
fn records_are_tagged_with_their_entity() {
    pins(
        &Record::Track(track()),
        json!({
            "entity": "track",
            "id": "0192f0c4-0000-7000-8000-000000000001",
            "title": "Song",
            "artist": "Artist",
            "album": "Album",
            "album_artist": null,
            "track_number": 3,
            "total_tracks": 12,
            "disc_number": null,
            "total_discs": null,
            "year": 1999,
            "genre": "Rock",
            "duration_seconds": 201.5,
            "sample_rate": 44100,
            "bitrate": 320,
            "codec": "mp3",
            "date_added": "2026-11-01T12:00:00+00:00",
            "recording_mbid": null,
            "release_mbid": null,
            "artist_mbids": ["a-mbid"],
            "album_artist_mbids": [],
            "file_size": 8000000,
            "file_mtime_ms": 1700000000000i64,
        }),
    );
    pins(
        &Record::ArtistArtwork(art_link("ac/dc", "portrait")),
        json!({
            "entity": "artist_artwork",
            "owner": "ac/dc",
            "kind": "portrait",
            "artwork": {
                "hash": "ab12",
                "mime": "image/jpeg",
                "width": 600,
                "height": null,
                "byte_size": 51200,
            },
        }),
    );
    pins(
        &Record::PlaylistTrack(PlaylistTrack {
            playlist_id: "p1".into(),
            track_id: "t1".into(),
            position: "a0".into(),
        }),
        json!({ "entity": "playlist_track", "playlist_id": "p1", "track_id": "t1", "position": "a0" }),
    );
    pins(
        &Record::GenreSetting(GenreSetting {
            genre_key: "jazz".into(),
            background_kind: Some("color".into()),
            background_start: Some("#112233".into()),
            background_end: None,
        }),
        json!({
            "entity": "genre_setting",
            "genre_key": "jazz",
            "background_kind": "color",
            "background_start": "#112233",
            "background_end": null,
        }),
    );
}

#[test]
fn every_record_kind_round_trips() {
    let records = [
        Record::Track(track()),
        Record::Playlist(Playlist {
            id: "p1".into(),
            title: "Mix".into(),
            description: None,
            date_created: "2026-11-01T12:00:00+00:00".into(),
            position: "a0".into(),
            image_mode: "generated".into(),
            cover_background: Some("#000".into()),
            cover_background_end: None,
            cover_icon: Some("star".into()),
        }),
        Record::PlaylistTrack(PlaylistTrack {
            playlist_id: "p1".into(),
            track_id: "t1".into(),
            position: "a0".into(),
        }),
        Record::TrackLyrics(TrackLyrics {
            track_id: "t1".into(),
            format: "synced".into(),
            source: Some("lrclib".into()),
            lines_json: r#"[{"t":0,"text":"la"}]"#.into(),
            plain_text: "la".into(),
        }),
        Record::TrackArtwork(art_link("t1", "front")),
        Record::ArtistArtwork(art_link("a:b", "portrait")),
        Record::PlaylistArtwork(art_link("p1", "cover")),
        Record::GenreSetting(GenreSetting {
            genre_key: "jazz".into(),
            background_kind: None,
            background_start: None,
            background_end: None,
        }),
    ];
    let mut seen = Vec::new();
    for record in records {
        let value = serde_json::to_value(&record).unwrap();
        assert_eq!(value["entity"], record.entity().as_str());
        let back: Record = serde_json::from_value(value).unwrap();
        assert_eq!(back, record);
        seen.push(record.entity());
    }
    assert_eq!(seen, Entity::ALL, "one record per entity, in order");
}

#[test]
fn keys_are_tagged_with_their_entity() {
    pins(
        &RecordKey::PlaylistTrack {
            playlist_id: "p1".into(),
            track_id: "t1".into(),
        },
        json!({ "entity": "playlist_track", "playlist_id": "p1", "track_id": "t1" }),
    );
    pins(
        &RecordKey::TrackArtwork {
            owner: "t1".into(),
            kind: "front".into(),
        },
        json!({ "entity": "track_artwork", "owner": "t1", "kind": "front" }),
    );
}

#[test]
fn snapshot_lists_every_record_kind() {
    pins(
        &Snapshot {
            library_id: LibraryId::new("lib"),
            rev: Rev(3),
            tracks: vec![],
            playlists: vec![],
            playlist_tracks: vec![],
            track_lyrics: vec![],
            track_artwork: vec![art_link("t1", "front")],
            artist_artwork: vec![],
            playlist_artwork: vec![],
            genre_settings: vec![],
        },
        json!({
            "library_id": "lib",
            "rev": 3,
            "tracks": [],
            "playlists": [],
            "playlist_tracks": [],
            "track_lyrics": [],
            "track_artwork": [{
                "owner": "t1",
                "kind": "front",
                "artwork": { "hash": "ab12", "mime": "image/jpeg", "width": 600, "height": null, "byte_size": 51200 },
            }],
            "artist_artwork": [],
            "playlist_artwork": [],
            "genre_settings": [],
        }),
    );
}

#[test]
fn changes_response_carries_changes_or_a_resnapshot() {
    let set = ChangeSet {
        library_id: LibraryId::new("lib"),
        since: Rev(2),
        rev: Rev(5),
        changes: vec![
            Change::Upsert {
                rev: Rev(3),
                record: Record::PlaylistTrack(PlaylistTrack {
                    playlist_id: "p1".into(),
                    track_id: "t1".into(),
                    position: "a0".into(),
                }),
            },
            Change::Delete {
                rev: Rev(5),
                key: RecordKey::Track { id: "t2".into() },
            },
        ],
    };
    assert_eq!(set.cursor().rev, Rev(5));
    assert_eq!(set.changes[1].key(), RecordKey::Track { id: "t2".into() });
    pins(
        &ChangesResponse::Changes(set),
        json!({
            "type": "changes",
            "library_id": "lib",
            "since": 2,
            "rev": 5,
            "changes": [
                {
                    "op": "upsert",
                    "rev": 3,
                    "record": { "entity": "playlist_track", "playlist_id": "p1", "track_id": "t1", "position": "a0" },
                },
                { "op": "delete", "rev": 5, "key": { "entity": "track", "id": "t2" } },
            ],
        }),
    );
    pins(
        &ChangesResponse::Resnapshot {
            reason: ResnapshotReason::ClientAhead,
            host: HostState {
                library_id: LibraryId::new("lib"),
                rev: Rev(4),
                oldest_rev: Rev::ZERO,
            },
        },
        json!({
            "type": "resnapshot",
            "reason": "client_ahead",
            "host": { "library_id": "lib", "rev": 4, "oldest_rev": 0 },
        }),
    );
}

#[test]
fn sync_actions_and_reasons() {
    pins(&SyncAction::UpToDate, json!({ "action": "up_to_date" }));
    pins(
        &SyncAction::FetchChanges { since: Rev(9) },
        json!({ "action": "fetch_changes", "since": 9 }),
    );
    for (reason, name) in [
        (ResnapshotReason::NeverSynced, "never_synced"),
        (ResnapshotReason::DifferentLibrary, "different_library"),
        (ResnapshotReason::ClientAhead, "client_ahead"),
        (ResnapshotReason::Compacted, "compacted"),
    ] {
        pins(
            &SyncAction::Resnapshot { reason },
            json!({ "action": "resnapshot", "reason": name }),
        );
    }
}
