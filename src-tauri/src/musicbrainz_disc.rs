use std::time::Duration;

use crate::activity_log::{self, LogLevel};

use serde::{Deserialize, Serialize};

const MUSICBRAINZ_USER_AGENT: &str = "Spiral/0.1.0 (https://github.com/brpowell/spiral)";
const METADATA_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

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
}

/// Direct MusicBrainz fetch without cache. Prefer [`crate::disc_metadata_cache::lookup_disc_metadata_cached_with_options`].
pub fn fetch_disc_metadata(tracks: &[(u32, f64)]) -> (DiscMetadataLookup, LookupCacheKind) {
    if tracks.is_empty() {
        return (
            DiscMetadataLookup {
                disc_id: None,
                candidates: Vec::new(),
                preferred: None,
            },
            LookupCacheKind::Miss,
        );
    }

    let disc_id = crate::cd::disc_id::compute_disc_id(tracks);
    let toc = crate::cd::disc_id::toc_query_string(tracks);
    let url = format!(
        "https://musicbrainz.org/ws/2/discid/-?toc={toc}&inc=recordings+artist-credits+labels&fmt=json"
    );

    activity_log::log(
        LogLevel::Info,
        "metadata.musicbrainz",
        format!("MusicBrainz disc lookup started for {disc_id}"),
        Some(serde_json::json!({
            "discId": disc_id,
            "trackCount": tracks.len(),
        })),
    );

    let client = match reqwest::blocking::Client::builder()
        .user_agent(MUSICBRAINZ_USER_AGENT)
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
            return (
                DiscMetadataLookup {
                    disc_id: Some(disc_id),
                    candidates: Vec::new(),
                    preferred: None,
                },
                LookupCacheKind::Error,
            );
        }
    };

    let response: serde_json::Value = match client.get(&url).send() {
        Ok(resp) if resp.status().is_success() => resp.json().unwrap_or(serde_json::Value::Null),
        Ok(resp) => {
            let status = resp.status();
            let error_body = resp.text().unwrap_or_default();
            let mb_error = serde_json::from_str::<serde_json::Value>(&error_body)
                .ok()
                .and_then(|value| value.get("error").and_then(|e| e.as_str()).map(str::to_string));
            activity_log::log(
                LogLevel::Error,
                "metadata.musicbrainz",
                format!("MusicBrainz lookup failed with HTTP {status}"),
                Some(serde_json::json!({
                    "discId": disc_id,
                    "httpStatus": status.as_u16(),
                    "toc": toc,
                    "musicBrainzError": mb_error,
                })),
            );
            return (
                DiscMetadataLookup {
                    disc_id: Some(disc_id),
                    candidates: Vec::new(),
                    preferred: None,
                },
                LookupCacheKind::Error,
            );
        }
        Err(err) => {
            activity_log::log(
                LogLevel::Error,
                "metadata.musicbrainz",
                "MusicBrainz lookup request failed",
                Some(serde_json::json!({
                    "discId": disc_id,
                    "error": err.to_string(),
                })),
            );
            return (
                DiscMetadataLookup {
                    disc_id: Some(disc_id),
                    candidates: Vec::new(),
                    preferred: None,
                },
                LookupCacheKind::Error,
            );
        }
    };

    let lookup = parse_disc_response(&response, disc_id.clone(), tracks);
    let kind = if lookup.candidates.is_empty() {
        LookupCacheKind::Miss
    } else {
        LookupCacheKind::Hit
    };

    let album_titles: Vec<_> = lookup
        .candidates
        .iter()
        .filter_map(|candidate| candidate.album.clone())
        .collect();

    activity_log::log(
        if kind == LookupCacheKind::Miss {
            LogLevel::Warn
        } else {
            LogLevel::Info
        },
        "metadata.musicbrainz",
        format!(
            "MusicBrainz lookup returned {} candidate(s)",
            lookup.candidates.len()
        ),
        Some(serde_json::json!({
            "discId": disc_id,
            "cacheKind": match kind {
                LookupCacheKind::Hit => "hit",
                LookupCacheKind::Miss => "miss",
                LookupCacheKind::Error => "error",
            },
            "candidateCount": lookup.candidates.len(),
            "albums": album_titles,
        })),
    );

    (lookup, kind)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LookupCacheKind {
    Hit,
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
    let album = release
        .get("title")
        .and_then(|title| title.as_str())
        .map(str::to_string);
    let album_artist = artist_credit_name(release.get("artist-credit"));
    let year = release
        .get("date")
        .and_then(|date| date.as_str())
        .and_then(parse_year);
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
        .is_some_and(|format| format.eq_ignore_ascii_case("CD"))
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
    let names = credits
        .iter()
        .filter_map(|entry| {
            entry
                .get("name")
                .and_then(|name| name.as_str())
                .or_else(|| {
                    entry
                        .get("artist")
                        .and_then(|artist| artist.get("name"))
                        .and_then(|name| name.as_str())
                })
        })
        .collect::<Vec<_>>();
    if names.is_empty() {
        None
    } else {
        Some(names.join(", "))
    }
}

fn parse_year(date: &str) -> Option<i32> {
    date.get(0..4)?.parse().ok()
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
            Some("Artist A, Artist B".to_string())
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

        let metadata = parse_release(&release, "disc-id", &[(1, 180.0), (2, 200.0)])
            .expect("parse release");

        assert_eq!(metadata.album.as_deref(), Some("Test Album"));
        assert_eq!(metadata.country.as_deref(), Some("US"));
        assert_eq!(metadata.label.as_deref(), Some("Test Label"));
        assert_eq!(metadata.tracks.len(), 2);
        assert_eq!(metadata.tracks[0].title, "First Song");
        assert_eq!(metadata.tracks[1].title, "Second Song");
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
