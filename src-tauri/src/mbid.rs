//! MusicBrainz identifier helpers for library rows.
//!
//! Picard’s Vorbis name `MUSICBRAINZ_TRACKID` stores a **recording** UUID, not the
//! MusicBrainz *track* (release-track) entity. Do not write a release-track id into
//! `recording_mbid` / `MUSICBRAINZ_TRACKID`.
//!
//! Artist credit lists are stored as JSON text. Empty lists map to SQL NULL.

/// Trim and lowercase a single MBID. Empty / whitespace → `None`.
pub fn normalize_mbid(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_ascii_lowercase())
}

/// Lowercase UUID (`8-4-4-4-12` hex). Invalid or empty → `None`.
pub fn parse_uuid_mbid(value: Option<&str>) -> Option<String> {
    let normalized = normalize_mbid(value)?;
    is_uuid_string(&normalized).then_some(normalized)
}

fn is_uuid_string(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    let is_dash = |i: usize| i == 8 || i == 13 || i == 18 || i == 23;
    bytes.iter().enumerate().all(|(i, &c)| {
        if is_dash(i) {
            c == b'-'
        } else {
            matches!(c, b'0'..=b'9' | b'a'..=b'f')
        }
    })
}

/// Serialize performer / album-artist MBID lists for `tracks`.
/// Empty after normalization is stored as SQL NULL.
pub fn serialize_mbid_list(ids: &[String]) -> Option<String> {
    let normalized: Vec<String> = ids
        .iter()
        .filter_map(|id| normalize_mbid(Some(id)))
        .collect();
    if normalized.is_empty() {
        return None;
    }
    Some(serde_json::to_string(&normalized).expect("mbid list serializes"))
}

/// Parse a JSON array of MBID strings. Missing, empty, `[]`, or invalid JSON → empty vec.
pub fn parse_mbid_list(value: Option<&str>) -> Vec<String> {
    let Some(raw) = value.map(str::trim).filter(|s| !s.is_empty()) else {
        return Vec::new();
    };
    let parsed: Vec<String> = match serde_json::from_str(raw) {
        Ok(ids) => ids,
        Err(_) => return Vec::new(),
    };
    parsed
        .into_iter()
        .filter_map(|id| normalize_mbid(Some(&id)))
        .collect()
}

/// Normalize recording/release IDs and JSON-encode credit lists for `tracks` columns.
pub fn sql_values(
    recording_mbid: Option<&str>,
    release_mbid: Option<&str>,
    artist_mbids: &[String],
    album_artist_mbids: &[String],
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    (
        normalize_mbid(recording_mbid),
        normalize_mbid(release_mbid),
        serialize_mbid_list(artist_mbids),
        serialize_mbid_list(album_artist_mbids),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_mbid_trims_lowercases_and_drops_empty() {
        assert_eq!(normalize_mbid(None), None);
        assert_eq!(normalize_mbid(Some("")), None);
        assert_eq!(normalize_mbid(Some("  ")), None);
        assert_eq!(
            normalize_mbid(Some(" 550E8400-E29B-41D4-A716-446655440000 ")).as_deref(),
            Some("550e8400-e29b-41d4-a716-446655440000")
        );
    }

    #[test]
    fn parse_uuid_mbid_accepts_only_hyphenated_hex() {
        assert_eq!(parse_uuid_mbid(None), None);
        assert_eq!(parse_uuid_mbid(Some("not-a-uuid")), None);
        assert_eq!(
            parse_uuid_mbid(Some("550e8400e29b41d4a716446655440000")),
            None
        );
        assert_eq!(
            parse_uuid_mbid(Some(" 550E8400-E29B-41D4-A716-446655440000 ")).as_deref(),
            Some("550e8400-e29b-41d4-a716-446655440000")
        );
    }

    #[test]
    fn serialize_mbid_list_maps_empty_to_none() {
        assert_eq!(serialize_mbid_list(&[]), None);
        assert_eq!(serialize_mbid_list(&[String::new(), "  ".into()]), None);
    }

    #[test]
    fn serialize_mbid_list_writes_lowercase_json() {
        let json = serialize_mbid_list(&[
            "550E8400-E29B-41D4-A716-446655440000".into(),
            " 1B3EA5F0-3C5A-4F0A-9C0E-0C1D2E3F4A5B ".into(),
        ])
        .unwrap();
        assert_eq!(
            json,
            r#"["550e8400-e29b-41d4-a716-446655440000","1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b"]"#
        );
    }

    #[test]
    fn parse_mbid_list_round_trips_and_treats_null_as_empty() {
        assert!(parse_mbid_list(None).is_empty());
        assert!(parse_mbid_list(Some("")).is_empty());
        assert!(parse_mbid_list(Some("[]")).is_empty());
        assert!(parse_mbid_list(Some("not-json")).is_empty());
        assert_eq!(
            parse_mbid_list(Some(
                r#"["550E8400-E29B-41D4-A716-446655440000", "", "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b"]"#
            )),
            vec![
                "550e8400-e29b-41d4-a716-446655440000".to_string(),
                "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b".to_string(),
            ]
        );
    }

    #[test]
    fn sql_values_normalizes_and_maps_empty_lists_to_none() {
        let (recording, release, artists, album_artists) = sql_values(
            Some(" 550E8400-E29B-41D4-A716-446655440000 "),
            None,
            &[String::new()],
            &["1B3EA5F0-3C5A-4F0A-9C0E-0C1D2E3F4A5B".into()],
        );
        assert_eq!(
            recording.as_deref(),
            Some("550e8400-e29b-41d4-a716-446655440000")
        );
        assert_eq!(release, None);
        assert_eq!(artists, None);
        assert_eq!(
            album_artists.as_deref(),
            Some(r#"["1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b"]"#)
        );
    }
}
