//! Per-genre settings the user has chosen, stored in the library database so they
//! outlive an app install. Genres themselves are derived from track tags, so this
//! table is keyed by the lowercase genre name and holds only what was customised:
//! a genre without a row uses the defaults. Add a column here for each new setting.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GenreBackgroundKind {
    /// A picked color, or a gradient from `start` to `end`.
    Color,
    /// The theme palette as a single flat color. (No background chosen at all is
    /// the theme palette as a gradient.)
    ThemeSolid,
}

impl GenreBackgroundKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Color => "color",
            Self::ThemeSolid => "theme_solid",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "color" => Some(Self::Color),
            "theme_solid" => Some(Self::ThemeSolid),
            _ => None,
        }
    }
}

/// A background the user chose for a genre. `start` and `end` (`#rrggbb`) are only
/// meaningful for [`GenreBackgroundKind::Color`]; `end` is None for a solid color.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenreBackground {
    pub kind: GenreBackgroundKind,
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenreSettings {
    pub genre_key: String,
    pub background: Option<GenreBackground>,
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// The stored shape of a background: a color needs a valid start (and a valid end
/// when given); the flat theme palette carries no colors.
fn normalized(background: &GenreBackground) -> Result<GenreBackground, String> {
    match background.kind {
        GenreBackgroundKind::ThemeSolid => Ok(GenreBackground {
            kind: GenreBackgroundKind::ThemeSolid,
            start: None,
            end: None,
        }),
        GenreBackgroundKind::Color => {
            let start = background
                .start
                .as_deref()
                .filter(|c| is_hex_color(c))
                .ok_or("a genre color needs a #rrggbb start")?;
            let end = match background.end.as_deref() {
                None => None,
                Some(c) if is_hex_color(c) => Some(c.to_string()),
                Some(_) => return Err("a genre gradient end must be #rrggbb".into()),
            };
            Ok(GenreBackground {
                kind: GenreBackgroundKind::Color,
                start: Some(start.to_string()),
                end,
            })
        }
    }
}

pub fn get_all(conn: &Connection) -> Result<Vec<GenreSettings>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT genre_key, background_kind, background_start, background_end
         FROM genre_settings ORDER BY genre_key",
    )?;
    let rows = stmt
        .query_map([], |row| {
            let kind: Option<String> = row.get(1)?;
            let background = kind
                .as_deref()
                .and_then(GenreBackgroundKind::parse)
                .map(|kind| GenreBackground {
                    kind,
                    start: row.get(2).ok().flatten(),
                    end: row.get(3).ok().flatten(),
                });
            Ok(GenreSettings {
                genre_key: row.get(0)?,
                background,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Delete rows that no longer customise anything, so untouched genres cost nothing.
fn prune_empty(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM genre_settings WHERE background_kind IS NULL",
        [],
    )?;
    Ok(())
}

/// Give every genre in `keys` this background, or clear it with None.
pub fn set_backgrounds(
    conn: &mut Connection,
    keys: &[String],
    background: Option<&GenreBackground>,
) -> Result<(), String> {
    let stored = background.map(normalized).transpose()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for key in keys {
        match &stored {
            Some(b) => tx.execute(
                "INSERT INTO genre_settings (genre_key, background_kind, background_start, background_end)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(genre_key) DO UPDATE SET
                   background_kind = excluded.background_kind,
                   background_start = excluded.background_start,
                   background_end = excluded.background_end",
                params![key, b.kind.as_str(), b.start, b.end],
            ),
            None => tx.execute(
                "UPDATE genre_settings SET background_kind = NULL,
                   background_start = NULL, background_end = NULL
                 WHERE genre_key = ?1",
                params![key],
            ),
        }
        .map_err(|e| e.to_string())?;
    }
    prune_empty(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Carry a genre's settings across a rename or merge. For each setting the
/// destination's own value wins; it adopts the source's only where it has none.
/// Add each new setting column to the `COALESCE` list below.
pub fn rename_key(
    conn: &mut Connection,
    old_key: &str,
    new_key: &str,
) -> Result<(), rusqlite::Error> {
    if old_key == new_key {
        return Ok(());
    }
    let tx = conn.transaction()?;
    let source: Option<(Option<String>, Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT background_kind, background_start, background_end
             FROM genre_settings WHERE genre_key = ?1",
            params![old_key],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    if let Some((kind, start, end)) = source {
        tx.execute(
            "INSERT INTO genre_settings (genre_key, background_kind, background_start, background_end)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(genre_key) DO UPDATE SET
               background_kind = COALESCE(genre_settings.background_kind, excluded.background_kind),
               background_start = CASE WHEN genre_settings.background_kind IS NULL
                 THEN excluded.background_start ELSE genre_settings.background_start END,
               background_end = CASE WHEN genre_settings.background_kind IS NULL
                 THEN excluded.background_end ELSE genre_settings.background_end END",
            params![new_key, kind, start, end],
        )?;
        tx.execute(
            "DELETE FROM genre_settings WHERE genre_key = ?1",
            params![old_key],
        )?;
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db_migrations;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        db_migrations::run(&conn, None).unwrap();
        conn
    }

    fn color(start: &str, end: Option<&str>) -> GenreBackground {
        GenreBackground {
            kind: GenreBackgroundKind::Color,
            start: Some(start.into()),
            end: end.map(Into::into),
        }
    }

    fn solid_theme() -> GenreBackground {
        GenreBackground {
            kind: GenreBackgroundKind::ThemeSolid,
            start: None,
            end: None,
        }
    }

    fn keys(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn background_of(conn: &Connection, key: &str) -> Option<GenreBackground> {
        get_all(conn)
            .unwrap()
            .into_iter()
            .find(|s| s.genre_key == key)
            .and_then(|s| s.background)
    }

    #[test]
    fn sets_one_background_on_many_genres_and_clears_it() {
        let mut conn = conn();
        let red = color("#ff0000", None);
        set_backgrounds(&mut conn, &keys(&["rock", "jazz"]), Some(&red)).unwrap();
        assert_eq!(background_of(&conn, "rock"), Some(red.clone()));
        assert_eq!(background_of(&conn, "jazz"), Some(red));

        set_backgrounds(&mut conn, &keys(&["rock"]), None).unwrap();
        assert_eq!(background_of(&conn, "rock"), None);
        // A genre with nothing customised has no row at all.
        assert_eq!(get_all(&conn).unwrap().len(), 1);
    }

    #[test]
    fn stores_a_gradient_and_the_flat_theme() {
        let mut conn = conn();
        let blue = color("#0000ff", Some("#000044"));
        set_backgrounds(&mut conn, &keys(&["rock"]), Some(&blue)).unwrap();
        set_backgrounds(&mut conn, &keys(&["jazz"]), Some(&solid_theme())).unwrap();
        assert_eq!(background_of(&conn, "rock"), Some(blue));
        assert_eq!(background_of(&conn, "jazz"), Some(solid_theme()));
    }

    #[test]
    fn rejects_malformed_colors() {
        let mut conn = conn();
        assert!(set_backgrounds(&mut conn, &keys(&["a"]), Some(&color("red", None))).is_err());
        assert!(set_backgrounds(
            &mut conn,
            &keys(&["a"]),
            Some(&color("#ff0000", Some("nope")))
        )
        .is_err());
        assert!(get_all(&conn).unwrap().is_empty());
    }

    #[test]
    fn rename_moves_the_settings() {
        let mut conn = conn();
        let red = color("#ff0000", None);
        set_backgrounds(&mut conn, &keys(&["rock"]), Some(&red)).unwrap();
        rename_key(&mut conn, "rock", "metal").unwrap();
        assert_eq!(background_of(&conn, "rock"), None);
        assert_eq!(background_of(&conn, "metal"), Some(red));
        assert_eq!(get_all(&conn).unwrap().len(), 1);
    }

    #[test]
    fn merge_keeps_the_destinations_own_background() {
        let mut conn = conn();
        let red = color("#ff0000", None);
        let blue = color("#0000ff", None);
        set_backgrounds(&mut conn, &keys(&["rock"]), Some(&red)).unwrap();
        set_backgrounds(&mut conn, &keys(&["metal"]), Some(&blue)).unwrap();
        rename_key(&mut conn, "rock", "metal").unwrap();
        assert_eq!(background_of(&conn, "metal"), Some(blue));
        assert_eq!(get_all(&conn).unwrap().len(), 1);
    }

    #[test]
    fn rename_to_the_same_key_changes_nothing() {
        let mut conn = conn();
        let red = color("#ff0000", None);
        set_backgrounds(&mut conn, &keys(&["rock"]), Some(&red)).unwrap();
        rename_key(&mut conn, "rock", "rock").unwrap();
        assert_eq!(background_of(&conn, "rock"), Some(red));
    }
}
