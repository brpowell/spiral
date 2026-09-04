use std::time::Duration;

use crate::activity_log::{self, LogLevel};
use crate::artist_tags::join_artist_field;
use crate::musicbrainz_http;

use serde::{Deserialize, Serialize};

const METADATA_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscTrackMetadata {
    pub number: u32,
    pub title: String,
    pub artist: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscMetadata {
    pub disc_id: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<i32>,
    #[serde(default)]
    pub genre: Option<String>,
    pub country: Option<String>,
    pub label: Option<String>,
    pub release_mbid: Option<String>,
    pub tracks: Vec<DiscTrackMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscMetadataLookup {
    pub disc_id: Option<String>,
    pub candidates: Vec<DiscMetadata>,
    #[serde(default)]
    pub preferred: Option<DiscMetadata>,
    #[serde(default)]
    pub kind: LookupCacheKind,
}

/// MusicBrainz TOC lookup URL (`discid/-?toc=…`).
pub(crate) fn toc_lookup_url(toc: &str) -> String {
    format!(
        "https://musicbrainz.org/ws/2/discid/-?toc={toc}&inc=recordings+artist-credits+labels+release-groups+genres&fmt=json"
    )
}

/// Direct MusicBrainz fetch without cache. Prefer [`crate::disc_metadata_cache::lookup_disc_metadata_cached_with_options`].
pub fn fetch_disc_metadata(tracks: &[(u32, f64)]) -> (DiscMetadataLookup, LookupCacheKind) {
    if tracks.is_empty() {
        return (
            DiscMetadataLookup {
                disc_id: None,
                candidates: Vec::new(),
                preferred: None,
                kind: LookupCacheKind::Miss,
            },
            LookupCacheKind::Miss,
        );
    }

    let disc_id = crate::cd::disc_id::compute_disc_id(tracks);
    let toc = crate::cd::disc_id::toc_query_string(tracks);
    let url = toc_lookup_url(&toc);

    let client = match reqwest::blocking::Client::builder()
        .user_agent(crate::USER_AGENT)
        .timeout(METADATA_REQUEST_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            activity_log::log(
                LogLevel::Error,
                "metadata.musicbrainz",
                "Failed to build HTTP client for MusicBrainz lookup",
                Some(serde_json::json!({
                    "discId": disc_id,
                    "error": err.to_string(),
                })),
            );
            return error_lookup(disc_id);
        }
    };

    let get = musicbrainz_http::send_get(&client, &url);
    let response: serde_json::Value = match get.result {
        Ok(resp) if resp.status().is_success() => resp.json().unwrap_or(serde_json::Value::Null),
        Ok(resp) => {
            let status = resp.status();
            let error_body = resp.text().unwrap_or_default();
            let mb_error = serde_json::from_str::<serde_json::Value>(&error_body)
                .ok()
                .and_then(|value| {
                    value
                        .get("error")
                        .and_then(|e| e.as_str())
                        .map(str::to_string)
                });
            activity_log::log(
                LogLevel::Error,
                "metadata.musicbrainz",
                musicbrainz_http::format_http_error("MusicBrainz lookup", status, get.attempts),
                Some(serde_json::json!({
                    "discId": disc_id,
                    "httpStatus": status.as_u16(),
                    "attempts": get.attempts,
                    "maxAttempts": musicbrainz_http::MAX_ATTEMPTS,
                    "toc": toc,
                    "url": url,
                    "musicBrainzError": mb_error,
                })),
            );
            return error_lookup(disc_id);
        }
        Err(err) => {
            let message = musicbrainz_http::format_transport_error(
                "MusicBrainz lookup",
                &err,
                METADATA_REQUEST_TIMEOUT,
                get.attempts,
            );
            let mut details = musicbrainz_http::transport_error_details(
                &err,
                METADATA_REQUEST_TIMEOUT,
                get.attempts,
            );
            details["discId"] = serde_json::json!(disc_id);
            details["url"] = serde_json::json!(url);
            activity_log::log(
                LogLevel::Error,
                "metadata.musicbrainz",
                message,
                Some(details),
            );
            return error_lookup(disc_id);
        }
    };

    let mut lookup = parse_disc_response(&response, disc_id.clone(), tracks);
    let kind = if lookup.candidates.is_empty() {
        LookupCacheKind::Miss
    } else {
        LookupCacheKind::Hit
    };
    lookup.kind = kind;

    (lookup, kind)
}

fn error_lookup(disc_id: String) -> (DiscMetadataLookup, LookupCacheKind) {
    (
        DiscMetadataLookup {
            disc_id: Some(disc_id),
            candidates: Vec::new(),
            preferred: None,
            kind: LookupCacheKind::Error,
        },
        LookupCacheKind::Error,
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LookupCacheKind {
    Hit,
    #[default]
    Miss,
    Error,
}

fn parse_disc_response(
    response: &serde_json::Value,
    disc_id: String,
    source_tracks: &[(u32, f64)],
) -> DiscMetadataLookup {
    let releases = response
        .get("releases")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let candidates = releases
        .iter()
        .filter_map(|release| parse_release(release, &disc_id, source_tracks).ok())
        .collect();

    DiscMetadataLookup {
        disc_id: Some(disc_id),
        candidates,
        preferred: None,
        kind: LookupCacheKind::Miss,
    }
}

fn parse_release(
    release: &serde_json::Value,
    disc_id: &str,
    source_tracks: &[(u32, f64)],
) -> Result<DiscMetadata, String> {
    let Some(medium) = select_cd_medium(
        release
            .get("media")
            .and_then(|value| value.as_array())
            .map(|media| media.as_slice())
            .unwrap_or(&[]),
        source_tracks,
    ) else {
        return Err("release has no matching CD medium".to_string());
    };

    let release_mbid = release
        .get("id")
        .and_then(|id| id.as_str())
        .map(str::to_string);
    let title = release
        .get("title")
        .and_then(|title| title.as_str())
        .map(str::to_string);
    let disambiguation = release
        .get("disambiguation")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let album = title.map(|title| match disambiguation {
        Some(comment) => format!("{title} ({})", title_case_words(comment)),
        None => title,
    });
    let album_artist = artist_credit_name(release.get("artist-credit"));
    let year = release
        .get("date")
        .and_then(|date| date.as_str())
        .and_then(parse_year);
    let genre = release_genre(release);
    let country = release
        .get("country")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let label = release_label(release);

    let mut tracks = parse_tracks_from_medium(medium, &album_artist, source_tracks);
    if tracks.is_empty() {
        tracks = source_tracks
            .iter()
            .map(|(number, _)| DiscTrackMetadata {
                number: *number,
                title: format!("Track {number}"),
                artist: album_artist.clone(),
            })
            .collect();
    }

    Ok(DiscMetadata {
        disc_id: Some(disc_id.to_string()),
        album,
        album_artist,
        year,
        genre,
        country,
        label,
        release_mbid,
        tracks,
    })
}

fn is_cd_medium(medium: &serde_json::Value) -> bool {
    medium
        .get("format")
        .and_then(|format| format.as_str())
        .is_some_and(is_cd_format)
}

/// MusicBrainz disc lookups return CD-family formats (`CD`, `Enhanced CD`, `HDCD`, …).
fn is_cd_format(format: &str) -> bool {
    let format = format.trim().to_ascii_lowercase();
    if format.is_empty() {
        return false;
    }
    if matches!(
        format.as_str(),
        "sacd" | "vcd" | "svcd" | "dvd" | "dvd-audio" | "dvd-video"
    ) {
        return false;
    }
    format.contains("cd")
}

fn select_cd_medium<'a>(
    media: &'a [serde_json::Value],
    source_tracks: &[(u32, f64)],
) -> Option<&'a serde_json::Value> {
    let target = source_tracks.len();

    media.iter().find(|medium| {
        is_cd_medium(medium)
            && medium
                .get("track-count")
                .and_then(|count| count.as_u64())
                .is_some_and(|count| count as usize == target)
    })
}

fn parse_tracks_from_medium(
    medium: &serde_json::Value,
    album_artist: &Option<String>,
    source_tracks: &[(u32, f64)],
) -> Vec<DiscTrackMetadata> {
    let Some(mb_tracks) = medium.get("tracks").and_then(|value| value.as_array()) else {
        return Vec::new();
    };

    let mut tracks = Vec::new();
    for track in mb_tracks {
        let number = track
            .get("position")
            .and_then(|value| value.as_u64())
            .map(|value| value as u32)
            .or_else(|| {
                track
                    .get("number")
                    .and_then(|value| value.as_str())
                    .and_then(|value| value.parse().ok())
            });
        let Some(number) = number else {
            continue;
        };
        let title = track
            .get("title")
            .and_then(|value| value.as_str())
            .or_else(|| {
                track
                    .get("recording")
                    .and_then(|recording| recording.get("title"))
                    .and_then(|title| title.as_str())
            })
            .map(str::to_string)
            .unwrap_or_else(|| format!("Track {number}"));
        let artist = track
            .get("artist-credit")
            .and_then(|value| artist_credit_name(Some(value)))
            .or_else(|| {
                track
                    .get("recording")
                    .and_then(|recording| recording.get("artist-credit"))
                    .and_then(|value| artist_credit_name(Some(value)))
            });
        tracks.push(DiscTrackMetadata {
            number,
            title,
            artist,
        });
    }

    if tracks.is_empty() {
        tracks = source_tracks
            .iter()
            .map(|(number, _)| DiscTrackMetadata {
                number: *number,
                title: format!("Track {number}"),
                artist: album_artist.clone(),
            })
            .collect();
    }

    tracks
}

fn artist_credit_name(value: Option<&serde_json::Value>) -> Option<String> {
    let credits = value?.as_array()?;
    let names = credits.iter().filter_map(|entry| {
        entry
            .get("name")
            .and_then(|name| name.as_str())
            .or_else(|| {
                entry
                    .get("artist")
                    .and_then(|artist| artist.get("name"))
                    .and_then(|name| name.as_str())
            })
    });
    join_artist_field(names)
}

fn parse_year(date: &str) -> Option<i32> {
    date.get(0..4)?.parse().ok()
}

/// Prefer release-group genres (where votes live); fall back to release genres.
fn release_genre(release: &serde_json::Value) -> Option<String> {
    let release_group = release.get("release-group");
    top_genre_name(release_group.and_then(|rg| rg.get("genres")))
        .or_else(|| top_genre_name(release.get("genres")))
}

fn top_genre_name(genres: Option<&serde_json::Value>) -> Option<String> {
    let genres = genres?.as_array()?;
    let mut best: Option<(&str, i64)> = None;
    for entry in genres {
        let Some(name) = entry.get("name").and_then(|n| n.as_str()).map(str::trim) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        let count = entry.get("count").and_then(|c| c.as_i64()).unwrap_or(0);
        match best {
            Some((_, best_count)) if count <= best_count => {}
            _ => best = Some((name, count)),
        }
    }
    best.map(|(name, _)| title_case_words(name))
}

fn title_case_words(value: &str) -> String {
    value
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => {
                    let mut titled = first.to_uppercase().collect::<String>();
                    titled.push_str(chars.as_str());
                    titled
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn release_label(release: &serde_json::Value) -> Option<String> {
    let labels = release.get("label-info")?.as_array()?;
    let mut names = Vec::new();
    for entry in labels {
        let Some(name) = entry
            .get("label")
            .and_then(|label| label.get("name"))
            .and_then(|name| name.as_str())
        else {
            continue;
        };
        if !names.iter().any(|existing: &String| existing == name) {
            names.push(name.to_string());
        }
    }
    if names.is_empty() {
        None
    } else {
        Some(names.join(", "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_track_list_returns_empty_lookup() {
        let (result, kind) = fetch_disc_metadata(&[]);
        assert!(result.candidates.is_empty());
        assert!(result.disc_id.is_none());
        assert_eq!(kind, LookupCacheKind::Miss);
    }

    #[test]
    fn parses_artist_credit_names() {
        let value = serde_json::json!([
            { "name": "Artist A" },
            { "artist": { "name": "Artist B" } }
        ]);
        assert_eq!(
            artist_credit_name(Some(&value)),
            Some("Artist A; Artist B".to_string())
        );
    }

    #[test]
    fn parses_track_titles_from_media_and_recordings() {
        let release = serde_json::json!({
            "id": "release-mbid",
            "title": "Test Album",
            "artist-credit": [{ "name": "Test Artist" }],
            "date": "1999",
            "country": "US",
            "label-info": [{ "label": { "name": "Test Label" } }],
            "media": [{
                "format": "CD",
                "track-count": 2,
                "tracks": [
                    {
                        "position": 1,
                        "recording": { "title": "First Song" }
                    },
                    {
                        "position": 2,
                        "recording": { "title": "Second Song" }
                    }
                ]
            }]
        });

        let metadata =
            parse_release(&release, "disc-id", &[(1, 180.0), (2, 200.0)]).expect("parse release");

        assert_eq!(metadata.album.as_deref(), Some("Test Album"));
        assert_eq!(metadata.country.as_deref(), Some("US"));
        assert_eq!(metadata.label.as_deref(), Some("Test Label"));
        assert!(metadata.genre.is_none());
        assert_eq!(metadata.tracks.len(), 2);
        assert_eq!(metadata.tracks[0].title, "First Song");
        assert_eq!(metadata.tracks[1].title, "Second Song");
    }

    #[test]
    fn appends_title_cased_disambiguation_to_album() {
        let release = serde_json::json!({
            "id": "release-thriller",
            "title": "Thriller",
            "disambiguation": "special edition",
            "artist-credit": [{ "name": "Michael Jackson" }],
            "media": [{
                "format": "CD",
                "track-count": 1,
                "tracks": [{ "position": 1, "recording": { "title": "Wanna Be Startin' Somethin'" } }]
            }]
        });

        let metadata = parse_release(&release, "disc-id", &[(1, 360.0)]).expect("parse release");
        assert_eq!(
            metadata.album.as_deref(),
            Some("Thriller (Special Edition)")
        );
    }

    #[test]
    fn picks_top_release_group_genre() {
        let release = serde_json::json!({
            "id": "release-mbid",
            "title": "Abbey Road",
            "artist-credit": [{ "name": "The Beatles" }],
            "genres": [{ "name": "ignored release genre", "count": 99 }],
            "release-group": {
                "genres": [
                    { "name": "pop", "count": 11 },
                    { "name": "rock", "count": 26 },
                    { "name": "pop rock", "count": 13 }
                ]
            },
            "media": [{
                "format": "CD",
                "track-count": 1,
                "tracks": [{ "position": 1, "recording": { "title": "Come Together" } }]
            }]
        });

        let metadata = parse_release(&release, "disc-id", &[(1, 240.0)]).expect("parse release");
        assert_eq!(metadata.genre.as_deref(), Some("Rock"));
    }

    #[test]
    fn falls_back_to_release_genres_when_release_group_empty() {
        let release = serde_json::json!({
            "id": "release-mbid",
            "title": "Test Album",
            "artist-credit": [{ "name": "Test Artist" }],
            "genres": [
                { "name": "jazz", "count": 3 },
                { "name": "bebop", "count": 1 }
            ],
            "release-group": { "genres": [] },
            "media": [{
                "format": "CD",
                "track-count": 1,
                "tracks": [{ "position": 1, "recording": { "title": "Song" } }]
            }]
        });

        let metadata = parse_release(&release, "disc-id", &[(1, 180.0)]).expect("parse release");
        assert_eq!(metadata.genre.as_deref(), Some("Jazz"));
    }

    #[test]
    fn parse_release_skips_non_cd_media() {
        let release = serde_json::json!({
            "id": "release-vinyl",
            "title": "Test Album",
            "artist-credit": [{ "name": "Test Artist" }],
            "media": [{
                "format": "Vinyl",
                "track-count": 2,
                "tracks": [
                    { "position": 1, "recording": { "title": "First Song" } },
                    { "position": 2, "recording": { "title": "Second Song" } }
                ]
            }]
        });

        assert!(parse_release(&release, "disc-id", &[(1, 180.0), (2, 200.0)]).is_err());
    }

    #[test]
    fn parse_release_accepts_enhanced_cd_medium() {
        let release = serde_json::json!({
            "id": "0c2b6134-3f1b-4567-8ba4-4828065917c6",
            "title": "Gorillaz",
            "artist-credit": [{ "name": "Gorillaz" }],
            "media": [{
                "format": "Enhanced CD",
                "track-count": 19,
                "tracks": [
                    { "position": 1, "recording": { "title": "Re-Hash" } }
                ]
            }]
        });

        let metadata =
            parse_release(&release, "disc-id", &[(1, 218.0); 19]).expect("parse release");
        assert_eq!(metadata.album.as_deref(), Some("Gorillaz"));
        assert_eq!(metadata.album_artist.as_deref(), Some("Gorillaz"));
    }

    #[test]
    fn parse_disc_response_filters_non_cd_releases() {
        let response = serde_json::json!({
            "releases": [
                {
                    "id": "release-a",
                    "title": "Album A",
                    "artist-credit": [{ "name": "Artist A" }],
                    "media": [{
                        "format": "CD",
                        "track-count": 1,
                        "tracks": [{ "position": 1, "recording": { "title": "Song A" } }]
                    }]
                },
                {
                    "id": "release-b",
                    "title": "Album B",
                    "artist-credit": [{ "name": "Artist B" }],
                    "media": [{
                        "format": "Digital Media",
                        "track-count": 1,
                        "tracks": [{ "position": 1, "recording": { "title": "Song B" } }]
                    }]
                }
            ]
        });

        let lookup = parse_disc_response(&response, "disc-id".to_string(), &[(1, 180.0)]);
        assert_eq!(lookup.candidates.len(), 1);
        assert_eq!(lookup.candidates[0].album.as_deref(), Some("Album A"));
    }

    #[test]
    fn parse_disc_response_returns_all_release_candidates() {
        let response = serde_json::json!({
            "releases": [
                {
                    "id": "release-a",
                    "title": "Album A",
                    "artist-credit": [{ "name": "Artist A" }],
                    "media": [{
                        "format": "CD",
                        "track-count": 1,
                        "tracks": [{ "position": 1, "recording": { "title": "Song A" } }]
                    }]
                },
                {
                    "id": "release-b",
                    "title": "Album B",
                    "artist-credit": [{ "name": "Artist B" }],
                    "media": [{
                        "format": "CD",
                        "track-count": 1,
                        "tracks": [{ "position": 1, "recording": { "title": "Song B" } }]
                    }]
                }
            ]
        });

        let lookup = parse_disc_response(&response, "disc-id".to_string(), &[(1, 180.0)]);
        assert_eq!(lookup.candidates.len(), 2);
        assert_eq!(lookup.candidates[0].album.as_deref(), Some("Album A"));
        assert_eq!(lookup.candidates[1].album.as_deref(), Some("Album B"));
    }
}
