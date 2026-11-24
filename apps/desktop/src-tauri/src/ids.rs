//! Text ids for library entities.
//!
//! Tracks, playlists and listen events are keyed by UUIDv7 strings, so ids made on different
//! devices never collide and still sort in creation order. Each kind of id is its own type, so a
//! track id can't be passed where a playlist id belongs. JSON and SQL see a plain string.

use rusqlite::types::{FromSql, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};
use std::fmt;

macro_rules! text_id {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Default, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);

        impl $name {
            /// A new id stamped with the current time.
            pub fn new() -> Self {
                Self(uuid::Uuid::now_v7().to_string())
            }

            /// `value` as an id when it is a UUID.
            pub fn parse(value: &str) -> Option<Self> {
                uuid::Uuid::parse_str(value).ok().map(|_| Self(value.to_owned()))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl TryFrom<String> for $name {
            type Error = String;

            fn try_from(value: String) -> Result<Self, Self::Error> {
                match uuid::Uuid::parse_str(&value) {
                    Ok(_) => Ok(Self(value)),
                    Err(_) => Err(format!("{} must be a UUID, got {value:?}", stringify!($name))),
                }
            }
        }

        impl From<$name> for String {
            fn from(value: $name) -> Self {
                value.0
            }
        }

        /// Unchecked, for tests that use short readable ids.
        #[cfg(test)]
        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self(value.to_owned())
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
                Ok(ToSqlOutput::from(self.0.as_str()))
            }
        }

        impl FromSql for $name {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
                String::column_result(value).map(Self)
            }
        }
    };
}

text_id!(
    /// Id of a row in `tracks`.
    TrackId
);
text_id!(
    /// Id of a row in `playlists`.
    PlaylistId
);
text_id!(
    /// Id of a row in `listen_events`.
    EventId
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_ids_are_v7_and_sort_by_creation() {
        let first = TrackId::new();
        let second = TrackId::new();
        let parsed = uuid::Uuid::parse_str(first.as_str()).expect("uuid");
        assert_eq!(parsed.get_version_num(), 7);
        assert!(first < second);
    }

    #[test]
    fn ids_serialize_as_plain_strings() {
        let id = PlaylistId::from("0190a1b2-0000-7000-8000-000000000000");
        let json = serde_json::to_string(&id).expect("serialize");
        assert_eq!(json, "\"0190a1b2-0000-7000-8000-000000000000\"");
        let back: PlaylistId = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, id);
    }

    #[test]
    fn json_ids_must_be_uuids() {
        assert!(serde_json::from_str::<TrackId>("\"../../etc\"").is_err());
        assert!(serde_json::from_str::<TrackId>("7").is_err());
        assert!(TrackId::parse("not-a-uuid").is_none());
        let id = TrackId::new();
        assert_eq!(TrackId::parse(id.as_str()), Some(id));
    }

    #[test]
    fn ids_round_trip_through_sqlite() {
        let conn = rusqlite::Connection::open_in_memory().expect("open");
        let id = EventId::new();
        let read: EventId = conn
            .query_row("SELECT ?1", [&id], |row| row.get(0))
            .expect("query");
        assert_eq!(read, id);
    }

    #[test]
    fn integer_column_is_not_read_as_an_id() {
        let conn = rusqlite::Connection::open_in_memory().expect("open");
        let read = conn.query_row("SELECT 7", [], |row| row.get::<_, TrackId>(0));
        assert!(read.is_err());
    }
}
