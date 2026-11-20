//! Shared artist field parsing and joining for tags and DB storage.

pub const ARTIST_TAG_DELIMITER: &str = "; ";

fn normalize_artist_name(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

/// Names that must not be split on semicolon even if present.
pub fn should_skip_semicolon_split(raw: &str) -> bool {
    let _ = raw;
    false
}

/// Split a stored artist field on semicolons. The only structural delimiter at runtime.
pub fn parse_artist_field(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if should_skip_semicolon_split(trimmed) {
        let name = normalize_artist_name(trimmed);
        return if name.is_empty() {
            Vec::new()
        } else {
            vec![name]
        };
    }
    trimmed
        .split(';')
        .map(normalize_artist_name)
        .filter(|s| !s.is_empty())
        .collect()
}

/// Join artist names for DB storage and MP3/M4A tag fields.
pub fn join_artist_field(values: impl IntoIterator<Item = impl AsRef<str>>) -> Option<String> {
    let parts: Vec<String> = values
        .into_iter()
        .map(|s| normalize_artist_name(s.as_ref()))
        .filter(|s| !s.is_empty())
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(ARTIST_TAG_DELIMITER))
    }
}

/// Artist names from one raw tag string as read from a file.
///
/// Splits on `;` (as [`parse_artist_field`] does) and on `\0`, the ID3v2.4
/// multi-value separator. A name containing `/` is split there only when a
/// part matches one of `anchors` (the track's album artists), since names like
/// AC/DC are common. iTunes and the ID3v2.3 spec join artists with `/`, so
/// `Kendrick Lamar/SZA` on an album by Kendrick Lamar becomes two artists.
/// MusicBrainz ID counts don't confirm a split: `AC/DC feat. X` has two IDs
/// and two `/` parts, neither of them an artist.
pub fn split_tag_artists(raw: &str, anchors: &[String]) -> Vec<String> {
    let names: Vec<String> = raw.split('\0').flat_map(parse_artist_field).collect();
    let anchors: Vec<String> = anchors.iter().map(|a| a.to_lowercase()).collect();
    names
        .into_iter()
        .flat_map(|name| {
            let parts: Vec<String> = name
                .split('/')
                .map(normalize_artist_name)
                .filter(|s| !s.is_empty())
                .collect();
            let confirmed =
                parts.len() > 1 && parts.iter().any(|p| anchors.contains(&p.to_lowercase()));
            if confirmed {
                parts
            } else {
                vec![name]
            }
        })
        .collect()
}

/// A track's artist and album artist as the library stores them: each split
/// by [`split_tag_artists`] and `; `-joined. The album artist is split first so
/// its names can confirm `/` in the track artist. Files read in and edits
/// saved both go through this, so a re-read never changes a saved edit.
pub fn split_artist_fields(
    artist: Option<&str>,
    album_artist: Option<&str>,
) -> (Option<String>, Option<String>) {
    let album_artists = album_artist
        .map(|raw| split_tag_artists(raw, &[]))
        .unwrap_or_default();
    let artist = artist.and_then(|raw| join_artist_field(split_tag_artists(raw, &album_artists)));
    (artist, join_artist_field(album_artists))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anchors(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn tag_artists_split_on_id3v24_null_separator() {
        assert_eq!(
            split_tag_artists("Beyoncé\0Jack White", &[]),
            vec!["Beyoncé", "Jack White"]
        );
        assert_eq!(split_tag_artists("A\0\0B; C", &[]), vec!["A", "B", "C"]);
    }

    #[test]
    fn tag_artists_split_slash_when_a_part_is_the_album_artist() {
        let album = anchors(&["Kendrick Lamar"]);
        assert_eq!(
            split_tag_artists("Kendrick Lamar/Blxst/Amanda Reifer", &album),
            vec!["Kendrick Lamar", "Blxst", "Amanda Reifer"]
        );
        assert_eq!(
            split_tag_artists("kendrick lamar / SZA", &album),
            vec!["kendrick lamar", "SZA"]
        );
    }

    #[test]
    fn artist_fields_split_track_artist_against_album_artist() {
        assert_eq!(
            split_artist_fields(Some("Lou Reed/John Cale"), Some("Lou Reed")),
            (
                Some("Lou Reed; John Cale".to_string()),
                Some("Lou Reed".to_string())
            )
        );
        assert_eq!(
            split_artist_fields(Some("AC/DC"), Some(" ")),
            (Some("AC/DC".to_string()), None)
        );
        assert_eq!(split_artist_fields(None, None), (None, None));
    }

    #[test]
    fn tag_artists_ignore_mbid_counts() {
        assert_eq!(
            split_tag_artists("AC/DC feat. X", &[]),
            vec!["AC/DC feat. X"]
        );
    }

    #[test]
    fn tag_artists_keep_slash_names_without_confirmation() {
        assert_eq!(split_tag_artists("AC/DC", &[]), vec!["AC/DC"]);
        assert_eq!(
            split_tag_artists("AC/DC", &anchors(&["AC/DC"])),
            vec!["AC/DC"]
        );
        assert_eq!(
            split_tag_artists("Body/Head", &anchors(&["Various Artists"])),
            vec!["Body/Head"]
        );
    }

    #[test]
    fn parse_splits_on_semicolon() {
        assert_eq!(parse_artist_field("A; B"), vec!["A", "B"]);
        assert_eq!(parse_artist_field("A;B"), vec!["A", "B"]);
    }

    #[test]
    fn parse_does_not_split_on_slash() {
        assert_eq!(parse_artist_field("AC/DC"), vec!["AC/DC"]);
        assert_eq!(parse_artist_field("A / B"), vec!["A / B"]);
    }

    #[test]
    fn parse_does_not_split_on_ampersand() {
        assert_eq!(
            parse_artist_field("King Gizzard & The Lizard Wizard"),
            vec!["King Gizzard & The Lizard Wizard"]
        );
    }

    #[test]
    fn join_artist_field_uses_semicolon_delimiter() {
        assert_eq!(join_artist_field(["A", "B"]), Some("A; B".to_string()));
        assert_eq!(join_artist_field(Vec::<&str>::new()), None);
    }
}
