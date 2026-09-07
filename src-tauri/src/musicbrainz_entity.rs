//! MusicBrainz entity search and lookup by MBID (release / recording / artist).
//!
//! Used by the MusicBrainz editor tab. Entity documents are cached in Library.db;
//! network fetch is explicit (Save & fetch / Fetch / search pick). Does not use the
//! CD TOC path in `musicbrainz_disc` (that requires a matching CD medium).

use crate::activity_log::{self, LogLevel};
use crate::artist_tags::join_artist_field;
use crate::db;
use crate::mbid::parse_uuid_mbid;
use crate::musicbrainz_http;
use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const SEARCH_LIMIT: u32 = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MusicBrainzEntityKind {
    Release,
    Recording,
    Artist,
}

impl MusicBrainzEntityKind {
    pub(crate) fn as_api_path(self) -> &'static str {
        match self {
            Self::Release => "release",
            Self::Recording => "recording",
            Self::Artist => "artist",
        }
    }

    fn search_result_key(self) -> &'static str {
        match self {
            Self::Release => "releases",
            Self::Recording => "recordings",
            Self::Artist => "artists",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MusicBrainzEntityHit {
    pub kind: MusicBrainzEntityKind,
    pub mbid: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disambiguation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Artist type (Person, Group, …) or release medium track count when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub area: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_count: Option<u32>,
}

/// One position on a release medium, for deriving track recording MBIDs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MusicBrainzTrackSlot {
    pub disc_number: u32,
    pub track_number: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recording_mbid: Option<String>,
}

/// Cached or freshly fetched entity card + optional release tracklist.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MusicBrainzEntityLookup {
    pub hit: MusicBrainzEntityHit,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tracklist: Vec<MusicBrainzTrackSlot>,
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(crate::USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client for MusicBrainz: {e}"))
}

fn urlencoding_simple(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn escape_lucene(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub(crate) fn build_search_query(
    kind: MusicBrainzEntityKind,
    query: &str,
    artist: Option<&str>,
) -> String {
    let q = query.trim();
    let artist = artist.map(str::trim).filter(|s| !s.is_empty());
    match kind {
        MusicBrainzEntityKind::Release => match artist {
            Some(a) => format!(
                "release:\"{}\" AND artist:\"{}\"",
                escape_lucene(q),
                escape_lucene(a)
            ),
            None => format!("release:\"{}\"", escape_lucene(q)),
        },
        MusicBrainzEntityKind::Recording => match artist {
            Some(a) => format!(
                "recording:\"{}\" AND artist:\"{}\"",
                escape_lucene(q),
                escape_lucene(a)
            ),
            None => format!("recording:\"{}\"", escape_lucene(q)),
        },
        MusicBrainzEntityKind::Artist => format!("artist:\"{}\"", escape_lucene(q)),
    }
}

pub(crate) fn search_url(kind: MusicBrainzEntityKind, query: &str, artist: Option<&str>) -> String {
    let lucene = build_search_query(kind, query, artist);
    format!(
        "https://musicbrainz.org/ws/2/{}?query={}&fmt=json&limit={SEARCH_LIMIT}",
        kind.as_api_path(),
        urlencoding_simple(&lucene)
    )
}

pub(crate) fn lookup_url(kind: MusicBrainzEntityKind, mbid: &str) -> String {
    let inc = match kind {
        MusicBrainzEntityKind::Release => "?inc=artist-credits+labels+recordings+media&fmt=json",
        MusicBrainzEntityKind::Recording => "?inc=artist-credits&fmt=json",
        MusicBrainzEntityKind::Artist => "?fmt=json",
    };
    format!(
        "https://musicbrainz.org/ws/2/{}/{mbid}{inc}",
        kind.as_api_path()
    )
}

fn log_mb(level: LogLevel, message: impl Into<String>, details: Option<serde_json::Value>) {
    activity_log::log(level, "metadata.musicbrainz", message, details);
}

fn fetch_json(url: &str, operation: &str) -> Result<serde_json::Value, String> {
    let client = http_client()?;
    let get = musicbrainz_http::send_get(&client, url);
    match get.result {
        Ok(resp) if resp.status().is_success() => {
            Ok(resp.json().unwrap_or(serde_json::Value::Null))
        }
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
            let message = musicbrainz_http::format_http_error(operation, status, get.attempts);
            log_mb(
                LogLevel::Error,
                &message,
                Some(serde_json::json!({
                    "url": url,
                    "httpStatus": status.as_u16(),
                    "attempts": get.attempts,
                    "maxAttempts": musicbrainz_http::MAX_ATTEMPTS,
                    "musicBrainzError": mb_error,
                })),
            );
            Err(message)
        }
        Err(err) => {
            let message = musicbrainz_http::format_transport_error(
                operation,
                &err,
                REQUEST_TIMEOUT,
                get.attempts,
            );
            let mut details =
                musicbrainz_http::transport_error_details(&err, REQUEST_TIMEOUT, get.attempts);
            details["url"] = serde_json::json!(url);
            log_mb(LogLevel::Error, &message, Some(details));
            Err(message)
        }
    }
}

pub fn search_entities(
    kind: MusicBrainzEntityKind,
    query: String,
    artist: Option<String>,
) -> Result<Vec<MusicBrainzEntityHit>, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let artist_ref = artist.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let url = search_url(kind, &query, artist_ref);
    log_mb(
        LogLevel::Info,
        format!(
            "Searching MusicBrainz {} for \"{query}\"",
            kind.as_api_path()
        ),
        Some(serde_json::json!({
            "kind": kind.as_api_path(),
            "query": query,
            "artist": artist_ref,
            "url": url,
        })),
    );
    let response = fetch_json(&url, "MusicBrainz entity search")?;
    let hits = parse_search_response(kind, &response);
    log_mb(
        LogLevel::Info,
        format!(
            "MusicBrainz {} search returned {} {}",
            kind.as_api_path(),
            hits.len(),
            if hits.len() == 1 { "hit" } else { "hits" }
        ),
        Some(serde_json::json!({
            "kind": kind.as_api_path(),
            "hitCount": hits.len(),
        })),
    );
    Ok(hits)
}

/// Read a cached entity from Library.db. Never contacts MusicBrainz.
pub fn get_entity(
    conn: &Connection,
    kind: MusicBrainzEntityKind,
    mbid: String,
) -> Result<Option<MusicBrainzEntityLookup>, String> {
    let Some(mbid) = parse_uuid_mbid(Some(&mbid)) else {
        return Ok(None);
    };
    let Some(json) = db::get_musicbrainz_entity_json(conn, kind.as_api_path(), &mbid)
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    let response: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("Invalid cached MusicBrainz JSON: {e}"))?;
    Ok(lookup_from_entity_json(kind, &response))
}

/// Network fetch then store. Caller supplies the DB connection only for the upsert
/// (HTTP runs before `with_conn` is invoked).
pub fn fetch_entity_with_store(
    kind: MusicBrainzEntityKind,
    mbid: String,
    mut with_conn: impl FnMut(&serde_json::Value) -> Result<(), String>,
) -> Result<Option<MusicBrainzEntityLookup>, String> {
    let Some(mbid) = parse_uuid_mbid(Some(&mbid)) else {
        return Ok(None);
    };
    let Some(response) = fetch_entity_json(kind, &mbid)? else {
        return Ok(None);
    };
    with_conn(&response)?;
    Ok(lookup_from_entity_json(kind, &response))
}

/// Fetch from MusicBrainz, upsert into Library.db, return parsed lookup.
#[cfg(test)]
pub fn fetch_entity(
    conn: &Connection,
    kind: MusicBrainzEntityKind,
    mbid: String,
) -> Result<Option<MusicBrainzEntityLookup>, String> {
    fetch_entity_with_store(kind, mbid, |response| {
        let mbid = response
            .get("id")
            .and_then(|id| id.as_str())
            .and_then(|id| parse_uuid_mbid(Some(id)))
            .ok_or_else(|| "MusicBrainz response missing entity id".to_string())?;
        store_entity_document(conn, kind, &mbid, response)
    })
}

fn fetch_entity_json(
    kind: MusicBrainzEntityKind,
    mbid: &str,
) -> Result<Option<serde_json::Value>, String> {
    let url = lookup_url(kind, mbid);
    log_mb(
        LogLevel::Info,
        format!("Looking up MusicBrainz {} {mbid}", kind.as_api_path()),
        Some(serde_json::json!({
            "kind": kind.as_api_path(),
            "mbid": mbid,
            "url": url,
        })),
    );
    let client = http_client()?;
    let get = musicbrainz_http::send_get(&client, &url);
    match get.result {
        Ok(resp) if resp.status().is_success() => {
            Ok(Some(resp.json().unwrap_or(serde_json::Value::Null)))
        }
        Ok(resp) if resp.status() == reqwest::StatusCode::NOT_FOUND => Ok(None),
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
            let message = musicbrainz_http::format_http_error(
                "MusicBrainz entity lookup",
                status,
                get.attempts,
            );
            log_mb(
                LogLevel::Error,
                &message,
                Some(serde_json::json!({
                    "url": url,
                    "httpStatus": status.as_u16(),
                    "attempts": get.attempts,
                    "maxAttempts": musicbrainz_http::MAX_ATTEMPTS,
                    "musicBrainzError": mb_error,
                })),
            );
            Err(message)
        }
        Err(err) => {
            let message = musicbrainz_http::format_transport_error(
                "MusicBrainz entity lookup",
                &err,
                REQUEST_TIMEOUT,
                get.attempts,
            );
            let mut details =
                musicbrainz_http::transport_error_details(&err, REQUEST_TIMEOUT, get.attempts);
            details["url"] = serde_json::json!(url);
            log_mb(LogLevel::Error, &message, Some(details));
            Err(message)
        }
    }
}

fn lookup_from_entity_json(
    kind: MusicBrainzEntityKind,
    response: &serde_json::Value,
) -> Option<MusicBrainzEntityLookup> {
    let hit = parse_lookup_response(kind, response)?;
    let tracklist = if kind == MusicBrainzEntityKind::Release {
        parse_release_tracklist(response)
    } else {
        Vec::new()
    };
    Some(MusicBrainzEntityLookup { hit, tracklist })
}

/// Upsert a fetched entity and nested recording/artist extracts (insert-if-absent).
pub fn store_entity_document(
    conn: &Connection,
    kind: MusicBrainzEntityKind,
    mbid: &str,
    response: &serde_json::Value,
) -> Result<(), String> {
    let fetched_at = Utc::now().to_rfc3339();
    let json = serde_json::to_string(response).map_err(|e| e.to_string())?;
    db::upsert_musicbrainz_entity(conn, kind.as_api_path(), mbid, &json, &fetched_at)
        .map_err(|e| e.to_string())?;
    insert_nested_entities_if_absent(conn, kind, response, &fetched_at)?;
    Ok(())
}

/// Cache release (+ nested) documents from a discid lookup response.
pub fn cache_discid_releases(
    conn: &Connection,
    response: &serde_json::Value,
) -> Result<(), String> {
    let Some(releases) = response.get("releases").and_then(|v| v.as_array()) else {
        return Ok(());
    };
    let fetched_at = Utc::now().to_rfc3339();
    for release in releases {
        let Some(mbid) = release
            .get("id")
            .and_then(|id| id.as_str())
            .and_then(|id| parse_uuid_mbid(Some(id)))
        else {
            continue;
        };
        let json = serde_json::to_string(release).map_err(|e| e.to_string())?;
        // Disc TOC payloads include media+recordings — treat as canonical release docs.
        db::upsert_musicbrainz_entity(
            conn,
            MusicBrainzEntityKind::Release.as_api_path(),
            &mbid,
            &json,
            &fetched_at,
        )
        .map_err(|e| e.to_string())?;
        insert_nested_entities_if_absent(
            conn,
            MusicBrainzEntityKind::Release,
            release,
            &fetched_at,
        )?;
    }
    Ok(())
}

fn insert_nested_entities_if_absent(
    conn: &Connection,
    kind: MusicBrainzEntityKind,
    response: &serde_json::Value,
    fetched_at: &str,
) -> Result<(), String> {
    match kind {
        MusicBrainzEntityKind::Release => {
            insert_artists_from_credits(conn, response.get("artist-credit"), fetched_at)?;
            if let Some(media) = response.get("media").and_then(|v| v.as_array()) {
                for medium in media {
                    let Some(tracks) = medium.get("tracks").and_then(|v| v.as_array()) else {
                        continue;
                    };
                    for track in tracks {
                        insert_artists_from_credits(conn, track.get("artist-credit"), fetched_at)?;
                        if let Some(recording) = track.get("recording") {
                            insert_recording_if_absent(conn, recording, fetched_at)?;
                            insert_artists_from_credits(
                                conn,
                                recording.get("artist-credit"),
                                fetched_at,
                            )?;
                        }
                    }
                }
            }
        }
        MusicBrainzEntityKind::Recording => {
            insert_artists_from_credits(conn, response.get("artist-credit"), fetched_at)?;
        }
        MusicBrainzEntityKind::Artist => {}
    }
    Ok(())
}

fn insert_recording_if_absent(
    conn: &Connection,
    recording: &serde_json::Value,
    fetched_at: &str,
) -> Result<(), String> {
    let Some(mbid) = recording
        .get("id")
        .and_then(|id| id.as_str())
        .and_then(|id| parse_uuid_mbid(Some(id)))
    else {
        return Ok(());
    };
    // Nested recording objects are enough to render a card (id/title/artist-credit).
    let json = serde_json::to_string(recording).map_err(|e| e.to_string())?;
    db::insert_musicbrainz_entity_if_absent(
        conn,
        MusicBrainzEntityKind::Recording.as_api_path(),
        &mbid,
        &json,
        fetched_at,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn insert_artists_from_credits(
    conn: &Connection,
    credits: Option<&serde_json::Value>,
    fetched_at: &str,
) -> Result<(), String> {
    let Some(credits) = credits.and_then(|v| v.as_array()) else {
        return Ok(());
    };
    for entry in credits {
        let Some(artist) = entry.get("artist") else {
            continue;
        };
        let Some(mbid) = artist
            .get("id")
            .and_then(|id| id.as_str())
            .and_then(|id| parse_uuid_mbid(Some(id)))
        else {
            continue;
        };
        let json = serde_json::to_string(artist).map_err(|e| e.to_string())?;
        db::insert_musicbrainz_entity_if_absent(
            conn,
            MusicBrainzEntityKind::Artist.as_api_path(),
            &mbid,
            &json,
            fetched_at,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Parse all media into disc/track slots using numeric `position` fields.
pub(crate) fn parse_release_tracklist(release: &serde_json::Value) -> Vec<MusicBrainzTrackSlot> {
    let Some(media) = release.get("media").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut slots = Vec::new();
    for (media_index, medium) in media.iter().enumerate() {
        let disc_number = medium
            .get("position")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or((media_index as u32).saturating_add(1));
        let Some(tracks) = medium.get("tracks").and_then(|v| v.as_array()) else {
            continue;
        };
        for (track_index, track) in tracks.iter().enumerate() {
            let track_number = track
                .get("position")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32)
                .unwrap_or((track_index as u32).saturating_add(1));
            let recording_mbid = track
                .get("recording")
                .and_then(|recording| recording.get("id"))
                .and_then(|id| id.as_str())
                .and_then(|id| parse_uuid_mbid(Some(id)));
            slots.push(MusicBrainzTrackSlot {
                disc_number,
                track_number,
                recording_mbid,
            });
        }
    }
    slots
}

pub(crate) fn parse_search_response(
    kind: MusicBrainzEntityKind,
    response: &serde_json::Value,
) -> Vec<MusicBrainzEntityHit> {
    let Some(items) = response
        .get(kind.search_result_key())
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| parse_entity_object(kind, item))
        .collect()
}

pub(crate) fn parse_lookup_response(
    kind: MusicBrainzEntityKind,
    response: &serde_json::Value,
) -> Option<MusicBrainzEntityHit> {
    parse_entity_object(kind, response)
}

fn parse_entity_object(
    kind: MusicBrainzEntityKind,
    value: &serde_json::Value,
) -> Option<MusicBrainzEntityHit> {
    let mbid = value
        .get("id")
        .and_then(|id| id.as_str())
        .and_then(|id| parse_uuid_mbid(Some(id)))?;

    match kind {
        MusicBrainzEntityKind::Release => parse_release_hit(mbid, value),
        MusicBrainzEntityKind::Recording => parse_recording_hit(mbid, value),
        MusicBrainzEntityKind::Artist => parse_artist_hit(mbid, value),
    }
}

fn parse_release_hit(mbid: String, release: &serde_json::Value) -> Option<MusicBrainzEntityHit> {
    let title = release
        .get("title")
        .and_then(|t| t.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();
    let disambiguation = optional_trimmed_string(release.get("disambiguation"));
    Some(MusicBrainzEntityHit {
        kind: MusicBrainzEntityKind::Release,
        mbid,
        title,
        artist: artist_credit_name(release.get("artist-credit")),
        disambiguation,
        year: release
            .get("date")
            .and_then(|d| d.as_str())
            .and_then(parse_year),
        country: optional_trimmed_string(release.get("country")),
        label: release_label(release),
        entity_type: None,
        area: None,
        track_count: release_track_count(release),
    })
}

fn parse_recording_hit(
    mbid: String,
    recording: &serde_json::Value,
) -> Option<MusicBrainzEntityHit> {
    let title = recording
        .get("title")
        .and_then(|t| t.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();
    Some(MusicBrainzEntityHit {
        kind: MusicBrainzEntityKind::Recording,
        mbid,
        title,
        artist: artist_credit_name(recording.get("artist-credit")),
        disambiguation: optional_trimmed_string(recording.get("disambiguation")),
        year: recording
            .get("first-release-date")
            .and_then(|d| d.as_str())
            .and_then(parse_year),
        country: None,
        label: None,
        entity_type: None,
        area: None,
        track_count: None,
    })
}

fn parse_artist_hit(mbid: String, artist: &serde_json::Value) -> Option<MusicBrainzEntityHit> {
    let title = artist
        .get("name")
        .and_then(|t| t.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();
    Some(MusicBrainzEntityHit {
        kind: MusicBrainzEntityKind::Artist,
        mbid,
        title,
        artist: None,
        disambiguation: optional_trimmed_string(artist.get("disambiguation")),
        year: None,
        country: artist_country_code(artist),
        label: None,
        entity_type: optional_trimmed_string(artist.get("type")),
        area: artist
            .get("area")
            .and_then(|a| a.get("name"))
            .and_then(|n| n.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        track_count: None,
    })
}

fn artist_country_code(artist: &serde_json::Value) -> Option<String> {
    if let Some(code) = optional_trimmed_string(artist.get("country")) {
        return Some(code);
    }
    artist
        .get("area")
        .and_then(|area| area.get("iso-3166-1-codes"))
        .and_then(|codes| codes.as_array())
        .and_then(|codes| {
            codes.iter().find_map(|code| {
                code.as_str()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            })
        })
}

fn optional_trimmed_string(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn parse_year(date: &str) -> Option<i32> {
    date.get(0..4)?.parse().ok()
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

fn release_track_count(release: &serde_json::Value) -> Option<u32> {
    let media = release.get("media")?.as_array()?;
    let mut total = 0u32;
    let mut found = false;
    for medium in media {
        if let Some(count) = medium
            .get("track-count")
            .and_then(|c| c.as_u64())
            .map(|c| c as u32)
        {
            total = total.saturating_add(count);
            found = true;
        }
    }
    found.then_some(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_search_query_escapes_and_scopes_by_kind() {
        assert_eq!(
            build_search_query(
                MusicBrainzEntityKind::Release,
                "Alien \"Metal\"",
                Some("KG")
            ),
            r#"release:"Alien \"Metal\"" AND artist:"KG""#
        );
        assert_eq!(
            build_search_query(MusicBrainzEntityKind::Recording, "Song", None),
            r#"recording:"Song""#
        );
        assert_eq!(
            build_search_query(MusicBrainzEntityKind::Artist, "Radiohead", None),
            r#"artist:"Radiohead""#
        );
    }

    #[test]
    fn search_and_lookup_urls_target_entity_paths() {
        let search = search_url(
            MusicBrainzEntityKind::Release,
            "OK Computer",
            Some("Radiohead"),
        );
        assert!(search.starts_with("https://musicbrainz.org/ws/2/release?query="));
        assert!(search.contains("fmt=json"));
        assert!(search.contains("limit=15"));

        let release_lookup = lookup_url(
            MusicBrainzEntityKind::Release,
            "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
        );
        assert!(release_lookup.contains("inc=artist-credits+labels+recordings+media"));

        let lookup = lookup_url(
            MusicBrainzEntityKind::Recording,
            "550e8400-e29b-41d4-a716-446655440000",
        );
        assert_eq!(
            lookup,
            "https://musicbrainz.org/ws/2/recording/550e8400-e29b-41d4-a716-446655440000?inc=artist-credits&fmt=json"
        );
    }

    #[test]
    fn parse_search_response_maps_releases() {
        let json = serde_json::json!({
            "releases": [
                {
                    "id": "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
                    "title": "OK Computer",
                    "date": "1997-05-21",
                    "country": "GB",
                    "disambiguation": "special edition",
                    "artist-credit": [{ "name": "Radiohead" }],
                    "label-info": [{ "label": { "name": "Parlophone" } }],
                    "media": [{ "track-count": 12 }]
                },
                {
                    "id": "not-a-uuid",
                    "title": "Skipped"
                }
            ]
        });
        let hits = parse_search_response(MusicBrainzEntityKind::Release, &json);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].mbid, "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b");
        assert_eq!(hits[0].title, "OK Computer");
        assert_eq!(hits[0].artist.as_deref(), Some("Radiohead"));
        assert_eq!(hits[0].year, Some(1997));
        assert_eq!(hits[0].country.as_deref(), Some("GB"));
        assert_eq!(hits[0].label.as_deref(), Some("Parlophone"));
        assert_eq!(hits[0].track_count, Some(12));
        assert_eq!(hits[0].disambiguation.as_deref(), Some("special edition"));
    }

    #[test]
    fn parse_lookup_response_maps_artist() {
        let json = serde_json::json!({
            "id": "a74b1b7f-71a5-4011-9441-d0b5e4122711",
            "name": "Radiohead",
            "type": "Group",
            "disambiguation": "",
            "country": "GB",
            "area": {
                "name": "United Kingdom",
                "iso-3166-1-codes": ["GB"]
            }
        });
        let hit = parse_lookup_response(MusicBrainzEntityKind::Artist, &json).unwrap();
        assert_eq!(hit.title, "Radiohead");
        assert_eq!(hit.entity_type.as_deref(), Some("Group"));
        assert_eq!(hit.area.as_deref(), Some("United Kingdom"));
        assert_eq!(hit.country.as_deref(), Some("GB"));
        assert!(hit.disambiguation.is_none());
    }

    #[test]
    fn parse_artist_country_from_area_iso_codes() {
        let json = serde_json::json!({
            "id": "a74b1b7f-71a5-4011-9441-d0b5e4122711",
            "name": "Radiohead",
            "area": {
                "name": "United Kingdom",
                "iso-3166-1-codes": ["GB"]
            }
        });
        let hit = parse_lookup_response(MusicBrainzEntityKind::Artist, &json).unwrap();
        assert_eq!(hit.country.as_deref(), Some("GB"));
        assert_eq!(hit.area.as_deref(), Some("United Kingdom"));
    }

    #[test]
    fn get_entity_rejects_invalid_uuid() {
        let conn = crate::db::open(std::path::Path::new(":memory:")).unwrap();
        let result = get_entity(&conn, MusicBrainzEntityKind::Release, "not-a-uuid".into());
        assert_eq!(result.unwrap(), None);
    }

    #[test]
    fn parse_recording_search_hit() {
        let json = serde_json::json!({
            "recordings": [{
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "title": "Paranoid Android",
                "first-release-date": "1997-05-26",
                "artist-credit": [
                    { "name": "Radiohead", "artist": { "id": "a74b1b7f-71a5-4011-9441-d0b5e4122711", "name": "Radiohead" } }
                ]
            }]
        });
        let hits = parse_search_response(MusicBrainzEntityKind::Recording, &json);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Paranoid Android");
        assert_eq!(hits[0].year, Some(1997));
        assert_eq!(hits[0].artist.as_deref(), Some("Radiohead"));
    }

    fn sample_release_with_media() -> serde_json::Value {
        serde_json::json!({
            "id": "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
            "title": "OK Computer",
            "date": "1997-05-21",
            "country": "GB",
            "artist-credit": [{
                "name": "Radiohead",
                "artist": { "id": "a74b1b7f-71a5-4011-9441-d0b5e4122711", "name": "Radiohead", "type": "Group" }
            }],
            "label-info": [{ "label": { "name": "Parlophone" } }],
            "media": [
                {
                    "position": 1,
                    "track-count": 2,
                    "tracks": [
                        {
                            "position": 1,
                            "number": "A1",
                            "recording": {
                                "id": "550e8400-e29b-41d4-a716-446655440000",
                                "title": "Airbag",
                                "artist-credit": [{
                                    "name": "Radiohead",
                                    "artist": { "id": "a74b1b7f-71a5-4011-9441-d0b5e4122711", "name": "Radiohead" }
                                }]
                            }
                        },
                        {
                            "position": 2,
                            "number": "A2",
                            "recording": {
                                "id": "11111111-1111-1111-1111-111111111111",
                                "title": "Paranoid Android"
                            }
                        }
                    ]
                },
                {
                    "position": 2,
                    "track-count": 1,
                    "tracks": [{
                        "position": 1,
                        "recording": {
                            "id": "22222222-2222-2222-2222-222222222222",
                            "title": "Bonus"
                        }
                    }]
                }
            ]
        })
    }

    #[test]
    fn parse_release_tracklist_uses_numeric_positions() {
        let slots = parse_release_tracklist(&sample_release_with_media());
        assert_eq!(slots.len(), 3);
        assert_eq!(slots[0].disc_number, 1);
        assert_eq!(slots[0].track_number, 1);
        assert_eq!(
            slots[0].recording_mbid.as_deref(),
            Some("550e8400-e29b-41d4-a716-446655440000")
        );
        assert_eq!(slots[1].disc_number, 1);
        assert_eq!(slots[1].track_number, 2);
        assert_eq!(slots[2].disc_number, 2);
        assert_eq!(slots[2].track_number, 1);
    }

    #[test]
    fn get_and_fetch_cache_round_trip() {
        let conn = crate::db::open(std::path::Path::new(":memory:")).unwrap();
        let release = sample_release_with_media();
        let mbid = "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b";

        assert!(
            get_entity(&conn, MusicBrainzEntityKind::Release, mbid.into())
                .unwrap()
                .is_none()
        );

        store_entity_document(&conn, MusicBrainzEntityKind::Release, mbid, &release).unwrap();

        let cached = get_entity(&conn, MusicBrainzEntityKind::Release, mbid.into())
            .unwrap()
            .expect("cached release");
        assert_eq!(cached.hit.title, "OK Computer");
        assert_eq!(cached.tracklist.len(), 3);

        let recording = get_entity(
            &conn,
            MusicBrainzEntityKind::Recording,
            "550e8400-e29b-41d4-a716-446655440000".into(),
        )
        .unwrap()
        .expect("nested recording insert-if-absent");
        assert_eq!(recording.hit.title, "Airbag");

        let artist = get_entity(
            &conn,
            MusicBrainzEntityKind::Artist,
            "a74b1b7f-71a5-4011-9441-d0b5e4122711".into(),
        )
        .unwrap()
        .expect("nested artist insert-if-absent");
        assert_eq!(artist.hit.title, "Radiohead");
    }

    #[test]
    fn nested_insert_does_not_clobber_explicit_recording() {
        let conn = crate::db::open(std::path::Path::new(":memory:")).unwrap();
        let recording_mbid = "550e8400-e29b-41d4-a716-446655440000";
        let fuller = serde_json::json!({
            "id": recording_mbid,
            "title": "Airbag (fuller)",
            "disambiguation": "studio",
            "first-release-date": "1997-05-21",
            "artist-credit": [{ "name": "Radiohead" }]
        });
        store_entity_document(
            &conn,
            MusicBrainzEntityKind::Recording,
            recording_mbid,
            &fuller,
        )
        .unwrap();

        store_entity_document(
            &conn,
            MusicBrainzEntityKind::Release,
            "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
            &sample_release_with_media(),
        )
        .unwrap();

        let cached = get_entity(
            &conn,
            MusicBrainzEntityKind::Recording,
            recording_mbid.into(),
        )
        .unwrap()
        .unwrap();
        assert_eq!(cached.hit.title, "Airbag (fuller)");
        assert_eq!(cached.hit.disambiguation.as_deref(), Some("studio"));
    }

    #[test]
    fn cache_discid_releases_upserts_candidates() {
        let conn = crate::db::open(std::path::Path::new(":memory:")).unwrap();
        let response = serde_json::json!({
            "releases": [sample_release_with_media()]
        });
        cache_discid_releases(&conn, &response).unwrap();
        let cached = get_entity(
            &conn,
            MusicBrainzEntityKind::Release,
            "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b".into(),
        )
        .unwrap()
        .unwrap();
        assert_eq!(cached.tracklist.len(), 3);
    }
}
