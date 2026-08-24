//! Fetch lyrics from [LRCLIB](https://lrclib.net/docs).

use std::error::Error as StdError;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;

use crate::activity_log::{self, LogLevel};
use crate::lyrics_fetch_cache::{self, cache_fingerprint, CachedLyricsLookup};
use crate::lyrics_lrc;
use crate::lyrics_tags;
use crate::models::{
    LyricsFetchCachePeek, LyricsFetchOutcome, LyricsFormat, LyricsSearchCandidate, LyricsSource,
    TrackLyricsInput,
};

const LRCLIB_USER_AGENT: &str = "Spiral/0.1.0 (https://github.com/brpowell/spiral)";
const LRCLIB_GET_URL: &str = "https://lrclib.net/api/get";
const LRCLIB_SEARCH_URL: &str = "https://lrclib.net/api/search";
/// `/api/get` may scrape external sources on cache miss; LRCLIB warns response time varies.
const GET_TIMEOUT: Duration = Duration::from_secs(30);
const SEARCH_TIMEOUT: Duration = Duration::from_secs(30);
const DURATION_TOLERANCE_SECS: f64 = 2.0;

/// Shared cancel flag for in-flight LRCLIB strategy chains (library "fetch missing" cancel).
static LYRICS_FETCH_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

pub const LYRICS_FETCH_CANCELLED_MESSAGE: &str = "Lyrics fetch cancelled";

/// Request that the current LRCLIB strategy chain stop before the next attempt.
pub fn request_cancel() {
    LYRICS_FETCH_CANCEL_REQUESTED.store(true, Ordering::SeqCst);
}

/// Clear a prior cancel request (call at the start of each fetch).
pub fn clear_cancel() {
    LYRICS_FETCH_CANCEL_REQUESTED.store(false, Ordering::SeqCst);
}

fn ensure_not_cancelled() -> Result<(), String> {
    if LYRICS_FETCH_CANCEL_REQUESTED.load(Ordering::SeqCst) {
        activity_log::log(
            LogLevel::Info,
            "lyrics.fetch",
            LYRICS_FETCH_CANCELLED_MESSAGE,
            None,
        );
        Err(LYRICS_FETCH_CANCELLED_MESSAGE.to_string())
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrclibResponse {
    #[serde(default)]
    plain_lyrics: Option<String>,
    #[serde(default)]
    synced_lyrics: Option<String>,
    #[serde(default)]
    instrumental: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrclibSearchHit {
    id: i64,
    track_name: String,
    artist_name: String,
    album_name: String,
    duration: f64,
    #[serde(default)]
    plain_lyrics: Option<String>,
    #[serde(default)]
    synced_lyrics: Option<String>,
    #[serde(default)]
    instrumental: bool,
}

#[derive(Debug, Deserialize)]
struct LrclibErrorResponse {
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
enum LrclibGetResult {
    Found(TrackLyricsInput),
    Instrumental,
    NotFound,
}

fn duration_secs_from_seconds(duration_seconds: Option<f64>) -> u32 {
    duration_seconds
        .map(|value| value.round().max(0.0) as u32)
        .unwrap_or(0)
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(LRCLIB_USER_AGENT)
        .build()
        .map_err(|err| format!("failed to create HTTP client: {err}"))
}

fn urlencoding_simple(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => ch.to_string(),
            ' ' => "+".to_string(),
            _ => format!("%{:02X}", ch as u8),
        })
        .collect()
}

fn lrclib_get_url(artist: &str, title: &str, album: &str, duration_secs: u32) -> String {
    format!(
        "{LRCLIB_GET_URL}?artist_name={}&track_name={}&album_name={}&duration={duration_secs}",
        urlencoding_simple(artist),
        urlencoding_simple(title),
        urlencoding_simple(album),
    )
}

fn lrclib_search_url(artist: &str, title: &str) -> String {
    format!(
        "{LRCLIB_SEARCH_URL}?track_name={}&artist_name={}",
        urlencoding_simple(title),
        urlencoding_simple(artist),
    )
}

fn collapse_whitespace(value: &str) -> String {
    value
        .trim()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn strip_apostrophes(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !matches!(ch, '\'' | '\u{2019}' | '\u{2018}' | '`' | '\u{00B4}'))
        .collect()
}

/// Normalize a metadata field before sending it to LRCLIB.
fn normalize_lrclib_text_field(value: &str) -> String {
    let without_semicolons: String = strip_apostrophes(value)
        .chars()
        .map(|ch| if ch == ';' { ' ' } else { ch })
        .collect();
    collapse_whitespace(&without_semicolons)
}

/// Use the primary credited artist and strip punctuation that broadens LRCLIB search.
fn normalize_lrclib_artist(artist: &str) -> String {
    let primary = crate::artist_tags::parse_artist_field(artist)
        .into_iter()
        .next()
        .unwrap_or_default();
    if primary.is_empty() {
        normalize_lrclib_text_field(artist)
    } else {
        normalize_lrclib_text_field(&primary)
    }
}

fn normalize_lrclib_query_fields(
    artist: &str,
    album_artist: &str,
    title: &str,
    album: &str,
) -> (String, String, String, String) {
    (
        normalize_lrclib_artist(artist),
        normalize_lrclib_artist(album_artist),
        normalize_lrclib_text_field(title),
        normalize_lrclib_text_field(album),
    )
}

fn normalize_for_match(value: &str) -> String {
    normalize_lrclib_text_field(value).to_ascii_lowercase()
}

/// Strip a trailing `(…)` or `[…]` suffix for a last-resort title fallback.
fn strip_trailing_parenthetical(title: &str) -> Option<String> {
    let mut stripped = title.trim().to_string();

    if let Some(idx) = stripped.rfind('(') {
        if stripped.ends_with(')') && idx > 0 {
            stripped = stripped[..idx].trim().to_string();
        }
    }

    if let Some(idx) = stripped.rfind('[') {
        if stripped.ends_with(']') && idx > 0 {
            stripped = stripped[..idx].trim().to_string();
        }
    }

    let normalized = normalize_lrclib_text_field(&stripped);
    if normalized.is_empty() || normalized == normalize_lrclib_text_field(title) {
        None
    } else {
        Some(normalized)
    }
}

fn outcome_from_search_candidates(candidates: Vec<LyricsSearchCandidate>) -> LyricsFetchOutcome {
    match candidates.len() {
        0 => LyricsFetchOutcome::NotFound,
        1 => {
            let candidate = candidates.into_iter().next().expect("one candidate");
            LyricsFetchOutcome::Found {
                lyrics: candidate.lyrics,
            }
        }
        _ => LyricsFetchOutcome::Ambiguous { candidates },
    }
}

fn fetch_lrclib_search_with_parenthetical_fallback(
    search_artist: &str,
    query_title: &str,
    match_title: &str,
    match_artist: &str,
    match_album: &str,
    duration_secs: u32,
) -> Result<LyricsFetchOutcome, String> {
    ensure_not_cancelled()?;

    let primary = fetch_lrclib_search_outcome(
        search_artist,
        query_title,
        match_title,
        match_artist,
        match_album,
        duration_secs,
        "search",
    );

    if let Ok(outcome) = &primary {
        if !matches!(outcome, LyricsFetchOutcome::NotFound) {
            return primary;
        }
    }

    let Some(fallback_title) = strip_trailing_parenthetical(query_title) else {
        return primary;
    };

    ensure_not_cancelled()?;

    activity_log::log(
        LogLevel::Info,
        "lyrics.fetch",
        "Retrying LRCLIB search without parenthetical title",
        Some(serde_json::json!({
            "originalTitle": query_title,
            "fallbackTitle": fallback_title,
            "primaryFailed": primary.is_err(),
        })),
    );

    fetch_lrclib_search_outcome(
        search_artist,
        &fallback_title,
        &fallback_title,
        match_artist,
        match_album,
        duration_secs,
        "search_without_parenthetical",
    )
}

fn fetch_lrclib_search_outcome(
    search_artist: &str,
    query_title: &str,
    match_title: &str,
    match_artist: &str,
    match_album: &str,
    duration_secs: u32,
    strategy: &str,
) -> Result<LyricsFetchOutcome, String> {
    let search_url = lrclib_search_url(search_artist, query_title);
    activity_log::log(
        LogLevel::Info,
        "lyrics.fetch",
        "Searching LRCLIB for lyrics",
        Some(serde_json::json!({
            "strategy": strategy,
            "artist": search_artist,
            "title": query_title,
            "durationSecs": duration_secs,
            "url": search_url,
        })),
    );

    let hits = fetch_lrclib_search(&search_url)?;
    let candidates =
        rank_search_candidates(hits, match_title, match_artist, match_album, duration_secs);
    Ok(outcome_from_search_candidates(candidates))
}

fn is_various_artists(artist: &str) -> bool {
    matches!(
        normalize_for_match(artist).as_str(),
        "various artists" | "various" | "va"
    )
}

fn should_try_album_artist_get(track_artist: &str, album_artist: &str) -> bool {
    let album = album_artist.trim();
    if album.is_empty() {
        return false;
    }
    if is_various_artists(album) {
        return false;
    }
    normalize_for_match(track_artist) != normalize_for_match(album)
}

fn preferred_search_artist(track_artist: &str, album_artist: &str) -> String {
    if !track_artist.trim().is_empty() {
        track_artist.trim().to_string()
    } else {
        album_artist.trim().to_string()
    }
}

fn lrclib_response_to_input(response: &LrclibResponse) -> Option<TrackLyricsInput> {
    if response.instrumental {
        return None;
    }

    let synced = response
        .synced_lyrics
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(synced_text) = synced {
        let parsed = lyrics_lrc::parse_lrc(synced_text);
        if !parsed.plain_text.trim().is_empty() {
            return Some(TrackLyricsInput {
                format: LyricsFormat::LineSynced,
                source: Some(LyricsSource::Lrclib),
                lines: parsed.lines,
                plain_text: parsed.plain_text,
            });
        }
    }

    let plain = response
        .plain_lyrics
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let mut input = lyrics_tags::track_lyrics_input_from_plain(plain);
    input.source = Some(LyricsSource::Lrclib);
    Some(input)
}

fn search_hit_to_candidate(hit: &LrclibSearchHit) -> Option<LyricsSearchCandidate> {
    let lyrics = lrclib_response_to_input(&LrclibResponse {
        plain_lyrics: hit.plain_lyrics.clone(),
        synced_lyrics: hit.synced_lyrics.clone(),
        instrumental: hit.instrumental,
    })?;
    Some(LyricsSearchCandidate {
        id: hit.id,
        track_name: hit.track_name.clone(),
        artist_name: hit.artist_name.clone(),
        album_name: hit.album_name.clone(),
        duration: hit.duration,
        lyrics,
    })
}

fn duration_within_tolerance(candidate_duration: f64, target_duration_secs: u32) -> bool {
    let target = target_duration_secs as f64;
    (candidate_duration - target).abs() <= DURATION_TOLERANCE_SECS
}

fn field_similarity_score(expected: &str, actual: &str) -> u32 {
    let expected = normalize_for_match(expected);
    let actual = normalize_for_match(actual);
    if expected.is_empty() || actual.is_empty() {
        return 0;
    }
    if expected == actual {
        return 100;
    }
    if actual.contains(&expected) || expected.contains(&actual) {
        return 50;
    }
    0
}

fn rank_search_candidates(
    hits: Vec<LrclibSearchHit>,
    title: &str,
    artist: &str,
    album: &str,
    duration_secs: u32,
) -> Vec<LyricsSearchCandidate> {
    let mut scored: Vec<(u32, LyricsSearchCandidate)> = hits
        .iter()
        .filter_map(|hit| {
            if hit.instrumental {
                return None;
            }
            if !duration_within_tolerance(hit.duration, duration_secs) {
                return None;
            }
            let candidate = search_hit_to_candidate(hit)?;
            let title_score = field_similarity_score(title, &candidate.track_name);
            if title_score == 0 {
                return None;
            }
            let score = title_score
                + field_similarity_score(artist, &candidate.artist_name)
                + field_similarity_score(album, &candidate.album_name) / 2;
            if score < 50 {
                return None;
            }
            Some((score, candidate))
        })
        .collect();

    scored.sort_by(|(score_a, a), (score_b, b)| {
        score_b
            .cmp(score_a)
            .then_with(|| a.track_name.cmp(&b.track_name))
            .then_with(|| a.id.cmp(&b.id))
    });

    scored.into_iter().map(|(_, candidate)| candidate).collect()
}

fn log_fetch_error(url: Option<&str>, error_message: &str, extra: Option<serde_json::Value>) {
    let mut details = match extra {
        Some(serde_json::Value::Object(map)) => serde_json::Value::Object(map),
        Some(value) => value,
        None => serde_json::json!({}),
    };
    if let Some(obj) = details.as_object_mut() {
        obj.insert("result".to_string(), serde_json::json!("error"));
        obj.insert("error".to_string(), serde_json::json!(error_message));
        if let Some(url) = url {
            obj.insert("url".to_string(), serde_json::json!(url));
        }
    }
    activity_log::log(
        LogLevel::Error,
        "lyrics.fetch",
        "Lyrics fetch failed",
        Some(details),
    );
}

fn reqwest_error_kind(err: &reqwest::Error) -> &'static str {
    if err.is_timeout() {
        "timeout"
    } else if err.is_connect() {
        "connect"
    } else if err.is_request() {
        "request"
    } else if err.is_body() {
        "body"
    } else if err.is_decode() {
        "decode"
    } else if err.is_status() {
        "status"
    } else {
        "other"
    }
}

fn reqwest_error_details(err: &reqwest::Error, timeout: Duration) -> serde_json::Value {
    let mut details = serde_json::json!({
        "errorKind": reqwest_error_kind(err),
        "errorDetail": err.to_string(),
        "timeoutSecs": timeout.as_secs(),
    });
    if let Some(status) = err.status() {
        details["httpStatus"] = serde_json::json!(status.as_u16());
    }
    if let Some(url) = err.url() {
        details["requestUrl"] = serde_json::json!(url.to_string());
    }
    if let Some(source) = StdError::source(err) {
        details["source"] = serde_json::json!(source.to_string());
    }
    details
}

fn format_lrclib_transport_error(err: &reqwest::Error, timeout: Duration) -> String {
    if err.is_timeout() {
        return format!(
            "LRCLIB request timed out after {} seconds",
            timeout.as_secs()
        );
    }
    if err.is_connect() {
        return format!("LRCLIB connection failed: {err}");
    }
    if let Some(status) = err.status() {
        return format!("LRCLIB returned HTTP {}", status.as_u16());
    }
    format!("LRCLIB request failed ({}): {err}", reqwest_error_kind(err))
}

fn log_reqwest_error(url: &str, err: &reqwest::Error, timeout: Duration) {
    let message = format_lrclib_transport_error(err, timeout);
    log_fetch_error(
        Some(url),
        &message,
        Some(reqwest_error_details(err, timeout)),
    );
}

fn send_lrclib_request_with_client(
    client: &reqwest::blocking::Client,
    url: &str,
    timeout: Duration,
) -> Result<reqwest::blocking::Response, reqwest::Error> {
    client.get(url).timeout(timeout).send()
}

fn send_lrclib_request_with_retry(
    client: &reqwest::blocking::Client,
    url: &str,
    timeout: Duration,
    operation: &str,
) -> Result<reqwest::blocking::Response, String> {
    match send_lrclib_request_with_client(client, url, timeout) {
        Ok(response) => Ok(response),
        Err(err) if err.is_timeout() => {
            ensure_not_cancelled()?;
            activity_log::log(
                LogLevel::Warn,
                "lyrics.fetch",
                &format!("LRCLIB {operation} timed out, retrying once"),
                Some(serde_json::json!({
                    "url": url,
                    "timeoutSecs": timeout.as_secs(),
                    "result": "timeout_retry",
                    "errorKind": "timeout",
                    "errorDetail": err.to_string(),
                    "operation": operation,
                })),
            );
            send_lrclib_request_with_client(client, url, timeout).map_err(|err| {
                log_reqwest_error(url, &err, timeout);
                format_lrclib_transport_error(&err, timeout)
            })
        }
        Err(err) => {
            log_reqwest_error(url, &err, timeout);
            Err(format_lrclib_transport_error(&err, timeout))
        }
    }
}

fn parse_lrclib_get_response(
    url: &str,
    title: &str,
    response: reqwest::blocking::Response,
) -> Result<LrclibGetResult, String> {
    let status = response.status();
    if status.as_u16() == 404 {
        activity_log::log(
            LogLevel::Warn,
            "lyrics.fetch",
            "LRCLIB returned no match",
            Some(serde_json::json!({
                "url": url,
                "httpStatus": 404,
                "result": "not_found",
            })),
        );
        return Ok(LrclibGetResult::NotFound);
    }

    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        let message = serde_json::from_str::<LrclibErrorResponse>(&body)
            .ok()
            .and_then(|parsed| parsed.message)
            .unwrap_or_else(|| format!("LRCLIB returned HTTP {}", status.as_u16()));
        log_fetch_error(
            Some(url),
            &message,
            Some(serde_json::json!({
                "httpStatus": status.as_u16(),
                "responseBody": body,
            })),
        );
        return Err(message);
    }

    let payload: LrclibResponse = match response.json() {
        Ok(payload) => payload,
        Err(err) => {
            let message = format!("failed to parse LRCLIB response: {err}");
            log_fetch_error(Some(url), &message, None);
            return Err(message);
        }
    };

    if payload.instrumental {
        activity_log::log(
            LogLevel::Info,
            "lyrics.fetch",
            "LRCLIB marked track as instrumental",
            Some(serde_json::json!({
                "url": url,
                "httpStatus": status.as_u16(),
                "result": "instrumental",
            })),
        );
        return Ok(LrclibGetResult::Instrumental);
    }

    let lyrics = lrclib_response_to_input(&payload);
    activity_log::log(
        if lyrics.is_some() {
            LogLevel::Info
        } else {
            LogLevel::Warn
        },
        "lyrics.fetch",
        if lyrics.is_some() {
            format!("Lyrics found for '{title}'")
        } else {
            format!("No usable lyrics found for '{title}'")
        },
        Some(serde_json::json!({
            "url": url,
            "httpStatus": status.as_u16(),
            "result": if lyrics.is_some() { "found" } else { "empty" },
            "format": lyrics.as_ref().map(|value| format!("{:?}", value.format)),
            "lineCount": lyrics.as_ref().map(|value| value.lines.len()),
            "plainTextLength": lyrics.as_ref().map(|value| value.plain_text.len()),
        })),
    );

    Ok(match lyrics {
        Some(lyrics) => LrclibGetResult::Found(lyrics),
        None => LrclibGetResult::NotFound,
    })
}

fn fetch_lrclib_get(url: &str, title: &str) -> Result<LrclibGetResult, String> {
    let client = http_client()?;
    let response = send_lrclib_request_with_retry(&client, url, GET_TIMEOUT, "get")?;
    parse_lrclib_get_response(url, title, response)
}

fn fetch_lrclib_search(url: &str) -> Result<Vec<LrclibSearchHit>, String> {
    let client = http_client()?;
    let response = send_lrclib_request_with_retry(&client, url, SEARCH_TIMEOUT, "search")?;

    let status = response.status();
    if status.as_u16() == 404 {
        return Ok(Vec::new());
    }

    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        let message = serde_json::from_str::<LrclibErrorResponse>(&body)
            .ok()
            .and_then(|parsed| parsed.message)
            .unwrap_or_else(|| format!("LRCLIB returned HTTP {}", status.as_u16()));
        log_fetch_error(
            Some(url),
            &message,
            Some(serde_json::json!({
                "httpStatus": status.as_u16(),
                "responseBody": body,
            })),
        );
        return Err(message);
    }

    let payload: Vec<LrclibSearchHit> = match response.json() {
        Ok(payload) => payload,
        Err(err) => {
            let message = format!("failed to parse LRCLIB response: {err}");
            log_fetch_error(Some(url), &message, None);
            return Err(message);
        }
    };

    activity_log::log(
        LogLevel::Info,
        "lyrics.fetch",
        "LRCLIB search returned candidates",
        Some(serde_json::json!({
            "url": url,
            "httpStatus": status.as_u16(),
            "result": "search",
            "candidateCount": payload.len(),
        })),
    );

    Ok(payload)
}

fn fetch_lrclib_uncached(
    artist: &str,
    album_artist: &str,
    title: &str,
    album: &str,
    duration_secs: u32,
) -> Result<LyricsFetchOutcome, String> {
    let (query_artist, query_album_artist, query_title, query_album) =
        normalize_lrclib_query_fields(artist, album_artist, title, album);
    let search_artist = preferred_search_artist(&query_artist, &query_album_artist);

    // 1. Primary /api/get with track artist
    let track_get_url = lrclib_get_url(&query_artist, &query_title, &query_album, duration_secs);
    activity_log::log(
        LogLevel::Info,
        "lyrics.fetch",
        format!("Fetching lyrics for '{query_title}'"),
        Some(serde_json::json!({
            "strategy": "get_track_artist",
            "artist": query_artist,
            "title": query_title,
            "album": query_album,
            "durationSecs": duration_secs,
            "url": track_get_url,
        })),
    );

    match fetch_lrclib_get(&track_get_url, &query_title)? {
        LrclibGetResult::Found(lyrics) => {
            return Ok(LyricsFetchOutcome::Found { lyrics });
        }
        LrclibGetResult::Instrumental => {
            return Ok(LyricsFetchOutcome::Instrumental);
        }
        LrclibGetResult::NotFound => {}
    }

    // 2. Optional /api/get with album artist when different
    if should_try_album_artist_get(artist, album_artist) {
        ensure_not_cancelled()?;
        let album_get_url = lrclib_get_url(
            &query_album_artist,
            &query_title,
            &query_album,
            duration_secs,
        );
        activity_log::log(
            LogLevel::Info,
            "lyrics.fetch",
            "Retrying LRCLIB get with album artist",
            Some(serde_json::json!({
                "strategy": "get_album_artist",
                "artist": query_album_artist,
                "title": query_title,
                "album": query_album,
                "durationSecs": duration_secs,
                "url": album_get_url,
            })),
        );

        match fetch_lrclib_get(&album_get_url, &query_title)? {
            LrclibGetResult::Found(lyrics) => {
                return Ok(LyricsFetchOutcome::Found { lyrics });
            }
            LrclibGetResult::Instrumental => {
                return Ok(LyricsFetchOutcome::Instrumental);
            }
            LrclibGetResult::NotFound => {}
        }
    }

    // 3. Search fallback, with one stripped-title retry when the parenthetical query fails.
    fetch_lrclib_search_with_parenthetical_fallback(
        &search_artist,
        &query_title,
        title,
        artist,
        album,
        duration_secs,
    )
}

/// Look up lyrics from LRCLIB, using the on-disk cache when possible.
///
/// When `respect_miss_cache` is false, a recent miss is ignored so explicit user
/// fetches can retry immediately (e.g. lyrics may have been uploaded since last time).
pub fn fetch_lyrics_lrclib_cached(
    app: &AppHandle,
    artist: String,
    album_artist: String,
    title: String,
    album: String,
    duration_seconds: Option<f64>,
    respect_miss_cache: bool,
) -> Result<LyricsFetchOutcome, String> {
    let artist = artist.trim().to_string();
    let album_artist = album_artist.trim().to_string();
    let title = title.trim().to_string();
    let album = album.trim().to_string();

    if artist.is_empty() || title.is_empty() {
        let message = "Artist and title are required to fetch lyrics".to_string();
        log_fetch_error(None, &message, None);
        return Err(message);
    }

    let duration_secs = duration_secs_from_seconds(duration_seconds);
    if duration_secs == 0 {
        let message = "Track duration is required to fetch lyrics from LRCLIB".to_string();
        log_fetch_error(None, &message, None);
        return Err(message);
    }

    let fingerprint = cache_fingerprint(&artist, &title, duration_secs);

    let cached = match lyrics_fetch_cache::get_cached_lookup(app, &fingerprint) {
        Ok(cached) => cached,
        Err(err) => {
            log_fetch_error(None, &err, None);
            return Err(err);
        }
    };

    match cached {
        CachedLyricsLookup::Hit(lyrics) => {
            activity_log::log(
                LogLevel::Info,
                "lyrics.fetch",
                "Lyrics fetch cache hit",
                Some(serde_json::json!({
                    "artist": artist,
                    "title": title,
                    "durationSecs": duration_secs,
                })),
            );
            return Ok(LyricsFetchOutcome::Found { lyrics });
        }
        CachedLyricsLookup::Instrumental if respect_miss_cache => {
            return Ok(LyricsFetchOutcome::Instrumental);
        }
        CachedLyricsLookup::Miss if respect_miss_cache => {
            return Ok(LyricsFetchOutcome::NotFound);
        }
        CachedLyricsLookup::Miss
        | CachedLyricsLookup::Instrumental
        | CachedLyricsLookup::NotCached => {}
    }

    match fetch_lrclib_uncached(&artist, &album_artist, &title, &album, duration_secs) {
        Ok(LyricsFetchOutcome::Found { lyrics }) => {
            lyrics_fetch_cache::store_cached_hit(app, fingerprint, lyrics.clone())?;
            Ok(LyricsFetchOutcome::Found { lyrics })
        }
        Ok(LyricsFetchOutcome::NotFound) => {
            lyrics_fetch_cache::store_cached_miss(app, fingerprint)?;
            Ok(LyricsFetchOutcome::NotFound)
        }
        Ok(LyricsFetchOutcome::Instrumental) => {
            lyrics_fetch_cache::store_cached_instrumental(app, fingerprint)?;
            Ok(LyricsFetchOutcome::Instrumental)
        }
        Ok(outcome @ LyricsFetchOutcome::Ambiguous { .. }) => Ok(outcome),
        Err(err) => {
            let _ = lyrics_fetch_cache::store_cached_error(app, fingerprint);
            Err(err)
        }
    }
}

pub fn peek_lyrics_fetch_cache(
    app: &AppHandle,
    artist: String,
    title: String,
    duration_seconds: Option<f64>,
) -> Result<LyricsFetchCachePeek, String> {
    let artist = artist.trim().to_string();
    let title = title.trim().to_string();

    if artist.is_empty() || title.is_empty() {
        return Err("Artist and title are required to peek lyrics fetch cache".to_string());
    }

    let duration_secs = duration_secs_from_seconds(duration_seconds);
    if duration_secs == 0 {
        return Err("Track duration is required to peek lyrics fetch cache".to_string());
    }

    let fingerprint = cache_fingerprint(&artist, &title, duration_secs);
    match lyrics_fetch_cache::get_cached_lookup(app, &fingerprint)? {
        CachedLyricsLookup::Miss => Ok(LyricsFetchCachePeek::Miss),
        CachedLyricsLookup::Hit(_) => Ok(LyricsFetchCachePeek::Hit),
        CachedLyricsLookup::Instrumental => Ok(LyricsFetchCachePeek::Instrumental),
        CachedLyricsLookup::NotCached => Ok(LyricsFetchCachePeek::NotCached),
    }
}

pub fn clear_fetch_cache(app: &AppHandle) -> Result<(), String> {
    lyrics_fetch_cache::clear_lookup_cache(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_response() -> LrclibResponse {
        LrclibResponse {
            plain_lyrics: Some("Line one\nLine two".to_string()),
            synced_lyrics: None,
            instrumental: false,
        }
    }

    #[test]
    fn reqwest_error_details_include_kind_and_detail() {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(1))
            .build()
            .expect("client");
        let err = client
            .get("http://127.0.0.1:1")
            .timeout(Duration::from_millis(1))
            .send()
            .expect_err("request should fail");
        let message = format_lrclib_transport_error(&err, Duration::from_millis(1));
        assert!(
            message.contains("timed out") || message.contains("connection failed"),
            "unexpected message: {message}"
        );
        let details = reqwest_error_details(&err, Duration::from_millis(1));
        assert_eq!(
            details["errorKind"].as_str().unwrap(),
            reqwest_error_kind(&err)
        );
        assert!(details["errorDetail"].as_str().is_some());
    }

    #[test]
    fn lrclib_response_prefers_synced_lyrics() {
        let input = lrclib_response_to_input(&LrclibResponse {
            plain_lyrics: Some("Plain only".to_string()),
            synced_lyrics: Some("[00:05.00] Synced line\n".to_string()),
            instrumental: false,
        })
        .expect("lyrics");

        assert_eq!(input.format, LyricsFormat::LineSynced);
        assert_eq!(input.source, Some(LyricsSource::Lrclib));
        assert_eq!(input.plain_text, "Synced line");
        assert_eq!(input.lines[0].start_ms, Some(5_000));
    }

    #[test]
    fn lrclib_response_uses_plain_when_synced_missing() {
        let input = lrclib_response_to_input(&sample_response()).expect("lyrics");

        assert_eq!(input.format, LyricsFormat::Plain);
        assert_eq!(input.plain_text, "Line one\nLine two");
    }

    #[test]
    fn lrclib_response_returns_none_for_instrumental() {
        assert!(lrclib_response_to_input(&LrclibResponse {
            plain_lyrics: None,
            synced_lyrics: None,
            instrumental: true,
        })
        .is_none());
    }

    #[test]
    fn normalize_lrclib_text_field_preserves_parentheses_in_title() {
        assert_eq!(
            normalize_lrclib_text_field("Bitch, Don't Kill My Vibe (remix)"),
            "Bitch, Dont Kill My Vibe (remix)"
        );
    }

    #[test]
    fn normalize_lrclib_text_field_strips_apostrophes_and_semicolons() {
        assert_eq!(normalize_lrclib_text_field("Don't Stop"), "Dont Stop");
        assert_eq!(normalize_lrclib_text_field("Song; Remix"), "Song Remix");
    }

    #[test]
    fn normalize_lrclib_artist_uses_primary_credit() {
        assert_eq!(normalize_lrclib_artist("Alice; Bob"), "Alice");
        assert_eq!(
            normalize_lrclib_artist("Tyler, the Creator"),
            "Tyler, the Creator"
        );
    }

    #[test]
    fn normalize_lrclib_query_fields_applies_title_and_artist_cleanup() {
        let (artist, album_artist, title, album) = normalize_lrclib_query_fields(
            "Rage Against the Machine; Guest",
            "Rage Against the Machine",
            "Born of a Broken Man (Remastered)",
            "The Battle of Los Angeles",
        );
        assert_eq!(artist, "Rage Against the Machine");
        assert_eq!(album_artist, "Rage Against the Machine");
        assert_eq!(title, "Born of a Broken Man (Remastered)");
        assert_eq!(album, "The Battle of Los Angeles");
    }

    #[test]
    fn strip_trailing_parenthetical_removes_suffix_when_present() {
        assert_eq!(
            strip_trailing_parenthetical("Born of a Broken Man (Remastered)"),
            Some("Born of a Broken Man".to_string())
        );
        assert_eq!(
            strip_trailing_parenthetical("Song Title [Live]"),
            Some("Song Title".to_string())
        );
        assert_eq!(
            strip_trailing_parenthetical(
                "dodger blue (feat. Wallie the Sensei, Siete7x, & Roddy Rich)"
            ),
            Some("dodger blue".to_string())
        );
        assert_eq!(strip_trailing_parenthetical("Plain Title"), None);
    }

    #[test]
    fn strip_trailing_parenthetical_preserves_mid_title_parentheses() {
        assert_eq!(
            strip_trailing_parenthetical("Song (Interlude) Part 2"),
            None
        );
    }

    #[test]
    fn should_try_album_artist_get_when_artists_differ() {
        assert!(should_try_album_artist_get("Alice; Bob", "Alice"));
        assert!(should_try_album_artist_get("Performer", "Band"));
    }

    #[test]
    fn should_skip_album_artist_get_when_equal_or_various() {
        assert!(!should_try_album_artist_get("Alice", "Alice"));
        assert!(!should_try_album_artist_get("Alice", "  Alice  "));
        assert!(!should_try_album_artist_get("Performer", "Various Artists"));
        assert!(!should_try_album_artist_get("Performer", ""));
    }

    #[test]
    fn duration_within_tolerance_allows_two_second_delta() {
        assert!(duration_within_tolerance(233.0, 231));
        assert!(duration_within_tolerance(233.0, 235));
        assert!(!duration_within_tolerance(233.0, 236));
    }

    #[test]
    fn rank_search_candidates_filters_duration_and_scores_title() {
        let hits = vec![
            LrclibSearchHit {
                id: 1,
                track_name: "Yesterday".to_string(),
                artist_name: "The Beatles".to_string(),
                album_name: "Help!".to_string(),
                duration: 125.0,
                plain_lyrics: Some("Yesterday lyrics".to_string()),
                synced_lyrics: None,
                instrumental: false,
            },
            LrclibSearchHit {
                id: 2,
                track_name: "Yesterday".to_string(),
                artist_name: "The Beatles".to_string(),
                album_name: "Help!".to_string(),
                duration: 200.0,
                plain_lyrics: Some("Wrong duration".to_string()),
                synced_lyrics: None,
                instrumental: false,
            },
            LrclibSearchHit {
                id: 3,
                track_name: "Something Else".to_string(),
                artist_name: "The Beatles".to_string(),
                album_name: "Help!".to_string(),
                duration: 125.0,
                plain_lyrics: Some("Other song".to_string()),
                synced_lyrics: None,
                instrumental: false,
            },
        ];

        let ranked = rank_search_candidates(hits, "Yesterday", "The Beatles", "Help!", 125);

        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].id, 1);
    }

    #[test]
    fn rank_search_candidates_returns_multiple_plausible_hits() {
        let hits = vec![
            LrclibSearchHit {
                id: 10,
                track_name: "22".to_string(),
                artist_name: "Taylor Swift".to_string(),
                album_name: "Red".to_string(),
                duration: 220.0,
                plain_lyrics: Some("Version A".to_string()),
                synced_lyrics: None,
                instrumental: false,
            },
            LrclibSearchHit {
                id: 11,
                track_name: "22".to_string(),
                artist_name: "Taylor Swift".to_string(),
                album_name: "Red (Deluxe)".to_string(),
                duration: 220.0,
                plain_lyrics: Some("Version B".to_string()),
                synced_lyrics: None,
                instrumental: false,
            },
        ];

        let ranked = rank_search_candidates(hits, "22", "Taylor Swift", "Red", 220);
        assert_eq!(ranked.len(), 2);
    }

    #[test]
    fn rank_search_candidates_drops_instrumental_hits() {
        let hits = vec![LrclibSearchHit {
            id: 4,
            track_name: "Track".to_string(),
            artist_name: "Artist".to_string(),
            album_name: "Album".to_string(),
            duration: 180.0,
            plain_lyrics: None,
            synced_lyrics: None,
            instrumental: true,
        }];

        let ranked = rank_search_candidates(hits, "Track", "Artist", "Album", 180);
        assert!(ranked.is_empty());
    }

    #[test]
    fn preferred_search_artist_uses_track_artist_first() {
        assert_eq!(
            preferred_search_artist("Track Artist", "Album Artist"),
            "Track Artist"
        );
        assert_eq!(preferred_search_artist("", "Album Artist"), "Album Artist");
    }

    #[test]
    fn ensure_not_cancelled_respects_cancel_flag() {
        clear_cancel();
        assert!(ensure_not_cancelled().is_ok());
        request_cancel();
        assert_eq!(
            ensure_not_cancelled().unwrap_err(),
            LYRICS_FETCH_CANCELLED_MESSAGE
        );
        clear_cancel();
        assert!(ensure_not_cancelled().is_ok());
    }
}
