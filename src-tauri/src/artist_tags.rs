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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(
            join_artist_field(["A", "B"]),
            Some("A; B".to_string())
        );
        assert_eq!(join_artist_field(Vec::<&str>::new()), None);
    }
}
