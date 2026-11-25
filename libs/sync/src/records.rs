//! The catalog records a host sends, one kind per logged entity.
//!
//! Records carry catalog data only. They leave out where files live and this
//! machine's scan state (`source_id`, `rel_path`, `missing_since`), the counter
//! caches (`play_count`, `last_played_at`, which clients compute from events),
//! and `rating`, which becomes per-profile user state. They also leave out
//! columns the change log ignores (`playlists.last_used_at`,
//! `track_lyrics.updated_at`), since a client could never keep those current.

use serde::{Deserialize, Serialize};
use std::fmt;

/// A track's catalog data. `file_size` and `file_mtime_ms` are kept so a
/// client can tell the audio was replaced (same id, new file).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i64>,
    pub total_tracks: Option<i64>,
    pub disc_number: Option<i64>,
    pub total_discs: Option<i64>,
    pub year: Option<i64>,
    pub genre: Option<String>,
    pub duration_seconds: Option<f64>,
    pub sample_rate: Option<i64>,
    pub bitrate: Option<i64>,
    pub codec: Option<String>,
    /// RFC 3339, when the host added the track.
    pub date_added: String,
    pub recording_mbid: Option<String>,
    pub release_mbid: Option<String>,
    pub artist_mbids: Vec<String>,
    pub album_artist_mbids: Vec<String>,
    pub file_size: Option<i64>,
    pub file_mtime_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Playlist {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    /// RFC 3339.
    pub date_created: String,
    /// Fractional position key for the sidebar order.
    pub position: String,
    pub image_mode: String,
    pub cover_background: Option<String>,
    pub cover_background_end: Option<String>,
    pub cover_icon: Option<String>,
}

/// One track in one playlist. A track is in a playlist at most once.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaylistTrack {
    pub playlist_id: String,
    pub track_id: String,
    /// Fractional position key within the playlist.
    pub position: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrackLyrics {
    pub track_id: String,
    pub format: String,
    pub source: Option<String>,
    /// The lyric lines as the host stores them (JSON).
    pub lines_json: String,
    pub plain_text: String,
}

/// An image in the host's artwork registry, addressed by the SHA-256 (hex) of
/// its bytes. Other bytes are another hash, so this never changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtworkInfo {
    pub hash: String,
    pub mime: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub byte_size: i64,
}

/// Links an owner (a track id, an artist key or a playlist id) and a `kind`
/// (`front`, `portrait`, `cover`, …) to an image.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtLink {
    pub owner: String,
    pub kind: String,
    pub artwork: ArtworkInfo,
}

/// Settings the user chose for one genre, keyed by its lowercase name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GenreSetting {
    pub genre_key: String,
    pub background_kind: Option<String>,
    pub background_start: Option<String>,
    pub background_end: Option<String>,
}

/// The kinds of entity the host logs, named as in its change log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Entity {
    Track,
    Playlist,
    PlaylistTrack,
    TrackLyrics,
    TrackArtwork,
    ArtistArtwork,
    PlaylistArtwork,
    GenreSetting,
}

impl Entity {
    pub const ALL: [Entity; 8] = [
        Entity::Track,
        Entity::Playlist,
        Entity::PlaylistTrack,
        Entity::TrackLyrics,
        Entity::TrackArtwork,
        Entity::ArtistArtwork,
        Entity::PlaylistArtwork,
        Entity::GenreSetting,
    ];

    /// The name the change log uses (`change_log.entity`).
    pub fn as_str(self) -> &'static str {
        match self {
            Entity::Track => "track",
            Entity::Playlist => "playlist",
            Entity::PlaylistTrack => "playlist_track",
            Entity::TrackLyrics => "track_lyrics",
            Entity::TrackArtwork => "track_artwork",
            Entity::ArtistArtwork => "artist_artwork",
            Entity::PlaylistArtwork => "playlist_artwork",
            Entity::GenreSetting => "genre_setting",
        }
    }

    pub fn from_name(name: &str) -> Option<Entity> {
        Entity::ALL.into_iter().find(|e| e.as_str() == name)
    }
}

impl fmt::Display for Entity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One catalog record, tagged with its entity.
// Not boxed: this is wire data and most records are tracks, so a box saves
// little, and plain fields keep it easy to bind for other languages.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "entity", rename_all = "snake_case")]
pub enum Record {
    Track(Track),
    Playlist(Playlist),
    PlaylistTrack(PlaylistTrack),
    TrackLyrics(TrackLyrics),
    TrackArtwork(ArtLink),
    ArtistArtwork(ArtLink),
    PlaylistArtwork(ArtLink),
    GenreSetting(GenreSetting),
}

impl Record {
    pub fn entity(&self) -> Entity {
        match self {
            Record::Track(_) => Entity::Track,
            Record::Playlist(_) => Entity::Playlist,
            Record::PlaylistTrack(_) => Entity::PlaylistTrack,
            Record::TrackLyrics(_) => Entity::TrackLyrics,
            Record::TrackArtwork(_) => Entity::TrackArtwork,
            Record::ArtistArtwork(_) => Entity::ArtistArtwork,
            Record::PlaylistArtwork(_) => Entity::PlaylistArtwork,
            Record::GenreSetting(_) => Entity::GenreSetting,
        }
    }

    /// The key that names this record, as a delete of it would carry.
    pub fn key(&self) -> RecordKey {
        let link = |l: &ArtLink| (l.owner.clone(), l.kind.clone());
        match self {
            Record::Track(t) => RecordKey::Track { id: t.id.clone() },
            Record::Playlist(p) => RecordKey::Playlist { id: p.id.clone() },
            Record::PlaylistTrack(pt) => RecordKey::PlaylistTrack {
                playlist_id: pt.playlist_id.clone(),
                track_id: pt.track_id.clone(),
            },
            Record::TrackLyrics(l) => RecordKey::TrackLyrics {
                track_id: l.track_id.clone(),
            },
            Record::TrackArtwork(l) => {
                let (owner, kind) = link(l);
                RecordKey::TrackArtwork { owner, kind }
            }
            Record::ArtistArtwork(l) => {
                let (owner, kind) = link(l);
                RecordKey::ArtistArtwork { owner, kind }
            }
            Record::PlaylistArtwork(l) => {
                let (owner, kind) = link(l);
                RecordKey::PlaylistArtwork { owner, kind }
            }
            Record::GenreSetting(g) => RecordKey::GenreSetting {
                genre_key: g.genre_key.clone(),
            },
        }
    }
}

/// Names one record of one entity, for deletes.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "entity", rename_all = "snake_case")]
pub enum RecordKey {
    Track {
        id: String,
    },
    Playlist {
        id: String,
    },
    PlaylistTrack {
        playlist_id: String,
        track_id: String,
    },
    TrackLyrics {
        track_id: String,
    },
    TrackArtwork {
        owner: String,
        kind: String,
    },
    ArtistArtwork {
        owner: String,
        kind: String,
    },
    PlaylistArtwork {
        owner: String,
        kind: String,
    },
    GenreSetting {
        genre_key: String,
    },
}

/// A change log row whose entity or id this crate can't read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyError {
    UnknownEntity(String),
    MalformedId { entity: Entity, id: String },
}

impl fmt::Display for KeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            KeyError::UnknownEntity(name) => write!(f, "unknown change log entity {name:?}"),
            KeyError::MalformedId { entity, id } => {
                write!(f, "malformed change log id {id:?} for entity {entity}")
            }
        }
    }
}

impl std::error::Error for KeyError {}

impl RecordKey {
    /// Reads a change log row's `entity` and `entity_id`.
    ///
    /// Composite ids join their parts with `:`. A playlist entry is
    /// `<playlist_id>:<track_id>` (both UUIDs). An art link is
    /// `<owner>:<kind>`: an artist key may hold `:` but a kind never does, so
    /// it splits at the last one.
    pub fn from_log(entity: &str, entity_id: &str) -> Result<RecordKey, KeyError> {
        let entity =
            Entity::from_name(entity).ok_or_else(|| KeyError::UnknownEntity(entity.into()))?;
        let malformed = || KeyError::MalformedId {
            entity,
            id: entity_id.into(),
        };
        let nonempty = |s: &str| (!s.is_empty()).then(|| s.to_string());
        let link = || {
            let (owner, kind) = entity_id.rsplit_once(':').ok_or_else(malformed)?;
            Ok::<_, KeyError>((
                nonempty(owner).ok_or_else(malformed)?,
                nonempty(kind).ok_or_else(malformed)?,
            ))
        };
        let single = || nonempty(entity_id).ok_or_else(malformed);
        Ok(match entity {
            Entity::Track => RecordKey::Track { id: single()? },
            Entity::Playlist => RecordKey::Playlist { id: single()? },
            Entity::PlaylistTrack => {
                let (playlist_id, track_id) = entity_id.split_once(':').ok_or_else(malformed)?;
                if track_id.contains(':') {
                    return Err(malformed());
                }
                RecordKey::PlaylistTrack {
                    playlist_id: nonempty(playlist_id).ok_or_else(malformed)?,
                    track_id: nonempty(track_id).ok_or_else(malformed)?,
                }
            }
            Entity::TrackLyrics => RecordKey::TrackLyrics {
                track_id: single()?,
            },
            Entity::TrackArtwork => {
                let (owner, kind) = link()?;
                RecordKey::TrackArtwork { owner, kind }
            }
            Entity::ArtistArtwork => {
                let (owner, kind) = link()?;
                RecordKey::ArtistArtwork { owner, kind }
            }
            Entity::PlaylistArtwork => {
                let (owner, kind) = link()?;
                RecordKey::PlaylistArtwork { owner, kind }
            }
            Entity::GenreSetting => RecordKey::GenreSetting {
                genre_key: single()?,
            },
        })
    }

    pub fn entity(&self) -> Entity {
        match self {
            RecordKey::Track { .. } => Entity::Track,
            RecordKey::Playlist { .. } => Entity::Playlist,
            RecordKey::PlaylistTrack { .. } => Entity::PlaylistTrack,
            RecordKey::TrackLyrics { .. } => Entity::TrackLyrics,
            RecordKey::TrackArtwork { .. } => Entity::TrackArtwork,
            RecordKey::ArtistArtwork { .. } => Entity::ArtistArtwork,
            RecordKey::PlaylistArtwork { .. } => Entity::PlaylistArtwork,
            RecordKey::GenreSetting { .. } => Entity::GenreSetting,
        }
    }

    /// The id the change log stores for this key (`change_log.entity_id`).
    pub fn log_id(&self) -> String {
        match self {
            RecordKey::Track { id } | RecordKey::Playlist { id } => id.clone(),
            RecordKey::PlaylistTrack {
                playlist_id,
                track_id,
            } => format!("{playlist_id}:{track_id}"),
            RecordKey::TrackLyrics { track_id } => track_id.clone(),
            RecordKey::TrackArtwork { owner, kind }
            | RecordKey::ArtistArtwork { owner, kind }
            | RecordKey::PlaylistArtwork { owner, kind } => format!("{owner}:{kind}"),
            RecordKey::GenreSetting { genre_key } => genre_key.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entity_names_round_trip() {
        for entity in Entity::ALL {
            assert_eq!(Entity::from_name(entity.as_str()), Some(entity));
        }
        assert_eq!(Entity::from_name("artist_image"), None);
    }

    #[test]
    fn keys_round_trip_through_the_log() {
        let keys = [
            RecordKey::Track { id: "t1".into() },
            RecordKey::Playlist { id: "p1".into() },
            RecordKey::PlaylistTrack {
                playlist_id: "p1".into(),
                track_id: "t1".into(),
            },
            RecordKey::TrackLyrics {
                track_id: "t1".into(),
            },
            RecordKey::TrackArtwork {
                owner: "t1".into(),
                kind: "front".into(),
            },
            RecordKey::ArtistArtwork {
                owner: "ac/dc: live".into(),
                kind: "portrait".into(),
            },
            RecordKey::PlaylistArtwork {
                owner: "p1".into(),
                kind: "cover".into(),
            },
            RecordKey::GenreSetting {
                genre_key: "hip hop".into(),
            },
        ];
        for key in keys {
            let parsed = RecordKey::from_log(key.entity().as_str(), &key.log_id()).unwrap();
            assert_eq!(parsed, key);
        }
    }

    #[test]
    fn an_artist_key_with_colons_splits_at_the_last_one() {
        let key = RecordKey::from_log("artist_artwork", "a:b:c:portrait").unwrap();
        assert_eq!(
            key,
            RecordKey::ArtistArtwork {
                owner: "a:b:c".into(),
                kind: "portrait".into()
            }
        );
    }

    #[test]
    fn unreadable_rows_are_errors() {
        assert_eq!(
            RecordKey::from_log("artist_image", "x"),
            Err(KeyError::UnknownEntity("artist_image".into()))
        );
        for (entity, id) in [
            ("track", ""),
            ("playlist_track", "p1"),
            ("playlist_track", "p1:"),
            ("playlist_track", ":t1"),
            ("playlist_track", "p1:t1:x"),
            ("track_artwork", "t1"),
            ("track_artwork", "t1:"),
            ("artist_artwork", ":portrait"),
        ] {
            assert!(
                matches!(
                    RecordKey::from_log(entity, id),
                    Err(KeyError::MalformedId { .. })
                ),
                "{entity} {id:?}"
            );
        }
    }
}
