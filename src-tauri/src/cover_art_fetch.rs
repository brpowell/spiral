use crate::activity_log::{self, LogLevel};
use crate::musicbrainz_http;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime};

const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const COVER_ART_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_RESULTS: usize = 12;
/// Rank floor for release-group fallback art so it never outranks release-specific fronts.
const RELEASE_GROUP_RANK_OFFSET: u32 = 50_000;
/// Cache key version — bump when empty-result behavior changes (e.g. new fallbacks).
const CACHE_KEY_VERSION: &str = "v6";

#[derive(Clone, Copy)]
enum CaaEntity {
    Release,
    ReleaseGroup,
}

impl CaaEntity {
    fn path(self) -> &'static str {
        match self {
            CaaEntity::Release => "release",
            CaaEntity::ReleaseGroup => "release-group",
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverArtCandidate {
    pub url: String,
    pub thumbnail_url: Option<String>,
    pub file_size: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Lower values are more canonical (release / image priority).
    pub canonical_rank: u32,
}

#[derive(Clone)]
struct CacheEntry {
    fetched_at: SystemTime,
    candidates: Vec<CoverArtCandidate>,
}

static FETCH_CACHE: LazyLock<Mutex<HashMap<String, CacheEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// CD auto-fetch owns its own start/complete lines; keep only errors there.
fn log_cover_art(level: LogLevel, message: impl Into<String>, details: Option<serde_json::Value>) {
    if level != LogLevel::Error && activity_log::thread_has_drive_id() {
        return;
    }
    activity_log::log(level, "metadata.coverArt", message, details);
}

pub fn fetch_cover_art_for_release_cached(
    release_mbid: String,
) -> Result<Vec<CoverArtCandidate>, String> {
    let mbid = release_mbid.trim();
    if mbid.is_empty() {
        return Ok(vec![]);
    }

    let key = format!("{CACHE_KEY_VERSION}|release|{}", mbid.to_ascii_lowercase());
    prune_expired();

    if let Some(entry) = FETCH_CACHE
        .lock()
        .map_err(|e| e.to_string())?
        .get(&key)
        .cloned()
    {
        if entry.fetched_at.elapsed().unwrap_or(CACHE_TTL) < CACHE_TTL {
            log_cover_art(
                LogLevel::Info,
                format!("In-memory cache hit for release {mbid}"),
                Some(serde_json::json!({
                    "releaseMbid": mbid,
                    "candidateCount": entry.candidates.len(),
                })),
            );
            return Ok(entry.candidates);
        }
    }

    let candidates = fetch_cover_art_for_release_uncached(mbid)?;
    let fetched_at = SystemTime::now();

    FETCH_CACHE.lock().map_err(|e| e.to_string())?.insert(
        key,
        CacheEntry {
            fetched_at,
            candidates: candidates.clone(),
        },
    );

    Ok(candidates)
}

pub fn fetch_cover_art_cached(
    artist: String,
    album: String,
) -> Result<Vec<CoverArtCandidate>, String> {
    if artist.trim().is_empty() && album.trim().is_empty() {
        return Ok(vec![]);
    }

    let key = cache_key(&artist, &album);
    prune_expired();

    if let Some(entry) = FETCH_CACHE
        .lock()
        .map_err(|e| e.to_string())?
        .get(&key)
        .cloned()
    {
        if entry.fetched_at.elapsed().unwrap_or(CACHE_TTL) < CACHE_TTL {
            log_cover_art(
                LogLevel::Info,
                format!("In-memory cache hit for \"{artist}\" — \"{album}\""),
                Some(serde_json::json!({
                    "artist": artist,
                    "album": album,
                    "candidateCount": entry.candidates.len(),
                })),
            );
            return Ok(entry.candidates);
        }
    }

    let candidates = fetch_cover_art_uncached(&artist, &album)?;
    let fetched_at = SystemTime::now();

    FETCH_CACHE.lock().map_err(|e| e.to_string())?.insert(
        key,
        CacheEntry {
            fetched_at,
            candidates: candidates.clone(),
        },
    );

    Ok(candidates)
}

fn cache_key(artist: &str, album: &str) -> String {
    format!(
        "{}|{}|{}",
        CACHE_KEY_VERSION,
        artist.trim().to_ascii_lowercase(),
        album.trim().to_ascii_lowercase()
    )
}

fn prune_expired() {
    let Ok(mut cache) = FETCH_CACHE.lock() else {
        return;
    };
    cache.retain(|_, entry| entry.fetched_at.elapsed().unwrap_or(CACHE_TTL) < CACHE_TTL);
}

pub fn clear_fetch_cache() {
    let Ok(mut cache) = FETCH_CACHE.lock() else {
        return;
    };
    cache.clear();
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(crate::USER_AGENT)
        .timeout(COVER_ART_REQUEST_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

fn fetch_cover_art_for_release_uncached(
    release_mbid: &str,
) -> Result<Vec<CoverArtCandidate>, String> {
    let client = http_client()?;
    let caa_url = caa_entity_url(CaaEntity::Release, release_mbid);
    log_cover_art(
        LogLevel::Info,
        format!("Fetching cover art for release {release_mbid}"),
        Some(serde_json::json!({
            "releaseMbid": release_mbid,
            "url": caa_url,
        })),
    );

    let mut fetch_failed = None;
    let mut candidates = Vec::new();
    extend_caa_or_record_error(
        fetch_caa_front_images(&client, CaaEntity::Release, release_mbid, 0),
        &mut candidates,
        &mut fetch_failed,
    );

    if candidates.is_empty() {
        if let Some(release_group_mbid) = lookup_release_group_mbid(&client, release_mbid) {
            extend_caa_or_record_error(
                fetch_caa_front_images(&client, CaaEntity::ReleaseGroup, &release_group_mbid, 0),
                &mut candidates,
                &mut fetch_failed,
            );
            apply_release_group_rank_offset(&mut candidates);
        }
    }

    if candidates.is_empty() {
        if let Some(err) = fetch_failed {
            log_cover_art(
                LogLevel::Error,
                &err,
                Some(serde_json::json!({
                    "releaseMbid": release_mbid,
                    "url": caa_url,
                })),
            );
            return Err(err);
        }
    }

    enrich_candidates(&client, &mut candidates);
    sort_and_truncate_candidates(&mut candidates);
    log_cover_art(
        if candidates.is_empty() {
            LogLevel::Warn
        } else {
            LogLevel::Info
        },
        format!(
            "Cover Art Archive returned {} for release {release_mbid}",
            counted_noun(candidates.len(), "candidate", "candidates"),
        ),
        Some(serde_json::json!({
            "releaseMbid": release_mbid,
            "url": caa_url,
            "candidateCount": candidates.len(),
        })),
    );
    Ok(candidates)
}

fn fetch_cover_art_uncached(artist: &str, album: &str) -> Result<Vec<CoverArtCandidate>, String> {
    let client = http_client()?;
    let search_url = musicbrainz_release_search_url(artist, album);

    log_cover_art(
        LogLevel::Info,
        format!("Searching cover art among releases for \"{artist}\" — \"{album}\""),
        Some(serde_json::json!({
            "artist": artist,
            "album": album,
            "url": search_url,
        })),
    );

    let get = musicbrainz_http::send_get(&client, &search_url);
    let search: serde_json::Value = match get.result {
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
            let message = musicbrainz_http::format_http_error(
                "MusicBrainz release search",
                status,
                get.attempts,
            );
            log_cover_art(
                LogLevel::Error,
                &message,
                Some(serde_json::json!({
                    "artist": artist,
                    "album": album,
                    "url": search_url,
                    "httpStatus": status.as_u16(),
                    "attempts": get.attempts,
                    "maxAttempts": musicbrainz_http::MAX_ATTEMPTS,
                    "musicBrainzError": mb_error,
                })),
            );
            return Err(message);
        }
        Err(err) => {
            let message = musicbrainz_http::format_transport_error(
                "MusicBrainz release search",
                &err,
                COVER_ART_REQUEST_TIMEOUT,
                get.attempts,
            );
            let mut details = musicbrainz_http::transport_error_details(
                &err,
                COVER_ART_REQUEST_TIMEOUT,
                get.attempts,
            );
            details["artist"] = serde_json::json!(artist);
            details["album"] = serde_json::json!(album);
            details["url"] = serde_json::json!(search_url);
            log_cover_art(LogLevel::Error, &message, Some(details));
            return Err(message);
        }
    };

    let releases = search
        .get("releases")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    let mut candidates = Vec::new();
    let mut fetch_failed = None;
    let mut release_count = 0usize;

    for (release_idx, release) in releases.iter().enumerate() {
        let Some(mbid) = release.get("id").and_then(|id| id.as_str()) else {
            continue;
        };
        release_count += 1;

        extend_caa_or_record_error(
            fetch_caa_front_images(&client, CaaEntity::Release, mbid, release_idx),
            &mut candidates,
            &mut fetch_failed,
        );
    }

    // Only when every matched release lacked front art — do not change the common case.
    if candidates.is_empty() {
        let release_group_mbids = unique_release_group_mbids(&releases);
        for (rg_idx, release_group_mbid) in release_group_mbids.iter().enumerate() {
            match fetch_caa_front_images(
                &client,
                CaaEntity::ReleaseGroup,
                release_group_mbid,
                rg_idx,
            ) {
                Ok(mut group_candidates) => {
                    apply_release_group_rank_offset(&mut group_candidates);
                    extend_caa_or_record_error(
                        Ok(group_candidates),
                        &mut candidates,
                        &mut fetch_failed,
                    );
                }
                Err(err) => {
                    extend_caa_or_record_error(Err(err), &mut candidates, &mut fetch_failed);
                }
            }
        }
    }

    if candidates.is_empty() {
        if let Some(err) = fetch_failed {
            log_cover_art(
                LogLevel::Error,
                &err,
                Some(serde_json::json!({
                    "artist": artist,
                    "album": album,
                    "url": search_url,
                    "releaseCount": release_count,
                })),
            );
            return Err(err);
        }
    }

    enrich_candidates(&client, &mut candidates);
    sort_and_truncate_candidates(&mut candidates);
    log_cover_art(
        if candidates.is_empty() {
            LogLevel::Warn
        } else {
            LogLevel::Info
        },
        cover_art_archive_search_message(artist, album, candidates.len(), release_count),
        Some(serde_json::json!({
            "artist": artist,
            "album": album,
            "candidateCount": candidates.len(),
            "releaseCount": release_count,
        })),
    );
    Ok(candidates)
}

fn apply_release_group_rank_offset(candidates: &mut [CoverArtCandidate]) {
    for candidate in candidates.iter_mut() {
        candidate.canonical_rank = candidate
            .canonical_rank
            .saturating_add(RELEASE_GROUP_RANK_OFFSET);
    }
}

fn counted_noun(count: usize, singular: &str, plural: &str) -> String {
    if count == 1 {
        format!("1 {singular}")
    } else {
        format!("{count} {plural}")
    }
}

fn cover_art_archive_search_message(
    artist: &str,
    album: &str,
    candidate_count: usize,
    release_count: usize,
) -> String {
    format!(
        "Cover Art Archive returned {} for \"{artist}\" — \"{album}\" across {}",
        counted_noun(candidate_count, "candidate", "candidates"),
        counted_noun(release_count, "release", "releases"),
    )
}

fn musicbrainz_release_search_url(artist: &str, album: &str) -> String {
    let query = format!(
        "release:\"{}\" AND artist:\"{}\"",
        album.replace('"', "\\\""),
        artist.replace('"', "\\\"")
    );
    format!(
        "https://musicbrainz.org/ws/2/release?query={}&fmt=json&limit=5",
        urlencoding_simple(&query)
    )
}

fn caa_entity_url(entity: CaaEntity, mbid: &str) -> String {
    format!("https://coverartarchive.org/{}/{mbid}", entity.path())
}

fn extend_caa_or_record_error(
    result: Result<Vec<CoverArtCandidate>, String>,
    candidates: &mut Vec<CoverArtCandidate>,
    fetch_failed: &mut Option<String>,
) {
    match result {
        Ok(images) => {
            candidates.extend(images);
            if !candidates.is_empty() {
                *fetch_failed = None;
            }
        }
        Err(err) => {
            if candidates.is_empty() && fetch_failed.is_none() {
                *fetch_failed = Some(err);
            }
        }
    }
}

fn release_group_id_from_value(value: &serde_json::Value) -> Option<&str> {
    value
        .get("release-group")
        .and_then(|rg| rg.get("id"))
        .and_then(|id| id.as_str())
        .filter(|id| !id.is_empty())
}

fn unique_release_group_mbids(releases: &[serde_json::Value]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for release in releases {
        let Some(id) = release_group_id_from_value(release) else {
            continue;
        };
        if seen.insert(id.to_ascii_lowercase()) {
            out.push(id.to_string());
        }
    }
    out
}

fn lookup_release_group_mbid(
    client: &reqwest::blocking::Client,
    release_mbid: &str,
) -> Option<String> {
    let url = format!("https://musicbrainz.org/ws/2/release/{release_mbid}?fmt=json");
    let get = musicbrainz_http::send_get(client, &url);
    let release: serde_json::Value = match get.result {
        Ok(resp) if resp.status().is_success() => resp.json().unwrap_or(serde_json::Value::Null),
        _ => return None,
    };
    release_group_id_from_value(&release).map(str::to_string)
}

fn fetch_caa_front_images(
    client: &reqwest::blocking::Client,
    entity: CaaEntity,
    mbid: &str,
    entity_idx: usize,
) -> Result<Vec<CoverArtCandidate>, String> {
    let caa_url = caa_entity_url(entity, mbid);
    let get = musicbrainz_http::send_get(client, &caa_url);
    let caa: serde_json::Value = match get.result {
        Ok(resp) if resp.status().is_success() => resp.json().unwrap_or(serde_json::Value::Null),
        Ok(resp) if resp.status().as_u16() == 404 => return Ok(vec![]),
        Ok(resp) => {
            return Err(musicbrainz_http::format_http_error(
                "Cover Art Archive request",
                resp.status(),
                get.attempts,
            ));
        }
        Err(err) => {
            return Err(musicbrainz_http::format_transport_error(
                "Cover Art Archive request",
                &err,
                COVER_ART_REQUEST_TIMEOUT,
                get.attempts,
            ));
        }
    };

    let Some(images) = caa.get("images").and_then(|i| i.as_array()) else {
        return Ok(vec![]);
    };

    Ok(parse_caa_front_candidates(images, entity_idx))
}

/// CAA sets `front: true` on only one primary image. Additional fronts still have
/// `types: ["Front"]` with `front: false` — include all of those for the picker.
fn caa_image_is_front(image: &serde_json::Value) -> bool {
    let types = image
        .get("types")
        .and_then(|t| t.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>())
        .unwrap_or_default();

    types.iter().any(|t| t.eq_ignore_ascii_case("front"))
        || image
            .get("front")
            .and_then(|f| f.as_bool())
            .unwrap_or(false)
        || types.is_empty()
}

fn parse_caa_front_candidates(
    images: &[serde_json::Value],
    entity_idx: usize,
) -> Vec<CoverArtCandidate> {
    let mut candidates = Vec::new();

    for (image_idx, image) in images.iter().enumerate() {
        if !caa_image_is_front(image) {
            continue;
        }

        let Some(url) = image.get("image").and_then(|u| u.as_str()) else {
            continue;
        };

        if candidates.iter().any(|c: &CoverArtCandidate| c.url == url) {
            continue;
        }

        let approved = image
            .get("approved")
            .and_then(|a| a.as_bool())
            .unwrap_or(true);
        let primary_front = image
            .get("front")
            .and_then(|f| f.as_bool())
            .unwrap_or(false);
        let mut canonical_rank = u32::try_from(entity_idx).unwrap_or(u32::MAX) * 1000
            + u32::try_from(image_idx).unwrap_or(u32::MAX);
        // Keep the CAA primary front ahead of other Front-typed images.
        if !primary_front {
            canonical_rank += 100;
        }
        if !approved {
            canonical_rank += 500;
        }

        let thumbnail_url = image
            .get("thumbnails")
            .and_then(|t| {
                t.get("small")
                    .or_else(|| t.get("large"))
                    .or_else(|| t.get("1200"))
                    .and_then(|u| u.as_str())
            })
            .map(str::to_string);

        candidates.push(CoverArtCandidate {
            url: url.to_string(),
            thumbnail_url,
            file_size: image
                .get("filesize")
                .and_then(|v| v.as_u64())
                .filter(|size| *size > 0),
            width: image
                .get("width")
                .and_then(|v| v.as_u64())
                .and_then(|n| u32::try_from(n).ok()),
            height: image
                .get("height")
                .and_then(|v| v.as_u64())
                .and_then(|n| u32::try_from(n).ok()),
            canonical_rank,
        });
    }

    candidates
}

fn sort_and_truncate_candidates(candidates: &mut Vec<CoverArtCandidate>) {
    candidates.sort_by(|a, b| {
        a.canonical_rank.cmp(&b.canonical_rank).then_with(|| {
            a.file_size
                .unwrap_or(u64::MAX)
                .cmp(&b.file_size.unwrap_or(u64::MAX))
        })
    });
    candidates.truncate(MAX_RESULTS);
}

/// CAA JSON from archive.org often omits `filesize` / `width` / `height`; fill via HEAD + URL hints.
fn enrich_candidates(client: &reqwest::blocking::Client, candidates: &mut [CoverArtCandidate]) {
    for candidate in candidates.iter_mut() {
        if candidate.width.is_none() || candidate.height.is_none() {
            if let Some((w, h)) = dimensions_from_url(&candidate.url) {
                candidate.width = Some(w);
                candidate.height = Some(h);
            }
        }

        if candidate.file_size.is_none() {
            candidate.file_size = fetch_content_length(client, &candidate.url);
        }
    }
}

fn dimensions_from_url(url: &str) -> Option<(u32, u32)> {
    for size in [1200u32, 500, 250] {
        let needle = format!("-{size}.");
        if url.contains(&needle) {
            return Some((size, size));
        }
    }
    None
}

/// Archive.org/CDNs often return `Content-Length: 0` for HEAD; use a 1-byte range GET when needed.
fn fetch_content_length(client: &reqwest::blocking::Client, url: &str) -> Option<u64> {
    if let Some(len) = head_content_length(client, url) {
        return Some(len);
    }
    range_content_length(client, url)
}

fn head_content_length(client: &reqwest::blocking::Client, url: &str) -> Option<u64> {
    client
        .head(url)
        .send()
        .ok()
        .filter(|r| r.status().is_success())
        .and_then(|r| r.content_length())
        .filter(|len| *len > 0)
}

fn range_content_length(client: &reqwest::blocking::Client, url: &str) -> Option<u64> {
    let response = client.get(url).header("Range", "bytes=0-0").send().ok()?;

    if let Some(total) = parse_content_range_total(response.headers().get("content-range")?) {
        return Some(total);
    }

    response.content_length().filter(|len| *len > 0)
}

fn parse_content_range_total(value: &reqwest::header::HeaderValue) -> Option<u64> {
    let header = value.to_str().ok()?;
    // e.g. "bytes 0-0/77767"
    let total = header.rsplit('/').next()?;
    total.parse().ok()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clear_fetch_cache_empties_entries() {
        FETCH_CACHE.lock().unwrap().insert(
            format!("{CACHE_KEY_VERSION}|artist|album"),
            CacheEntry {
                fetched_at: SystemTime::now(),
                candidates: vec![],
            },
        );
        clear_fetch_cache();
        assert!(FETCH_CACHE.lock().unwrap().is_empty());
    }

    fn sample_candidate(url: &str) -> CoverArtCandidate {
        CoverArtCandidate {
            url: url.into(),
            thumbnail_url: None,
            file_size: None,
            width: None,
            height: None,
            canonical_rank: 0,
        }
    }

    #[test]
    fn musicbrainz_release_search_url_includes_query() {
        let url = musicbrainz_release_search_url("King Gizzard & The Lizard Wizard", "Alien Metal");
        assert!(url.starts_with("https://musicbrainz.org/ws/2/release?query="));
        assert!(url.contains("Alien+Metal"));
        assert!(url.contains("fmt=json"));
    }

    #[test]
    fn cover_art_archive_search_message_names_counts() {
        assert_eq!(
            cover_art_archive_search_message("My Chemical Romance", "The Black Parade", 12, 5),
            "Cover Art Archive returned 12 candidates for \"My Chemical Romance\" — \"The Black Parade\" across 5 releases"
        );
        assert_eq!(
            cover_art_archive_search_message("Artist", "Album", 1, 1),
            "Cover Art Archive returned 1 candidate for \"Artist\" — \"Album\" across 1 release"
        );
    }

    #[test]
    fn extend_caa_keeps_transport_failure_until_images_arrive() {
        let mut candidates = Vec::new();
        let mut fetch_failed = None;
        extend_caa_or_record_error(
            Err("MusicBrainz release search timed out after 10 seconds".into()),
            &mut candidates,
            &mut fetch_failed,
        );
        extend_caa_or_record_error(Ok(vec![]), &mut candidates, &mut fetch_failed);
        assert!(candidates.is_empty());
        assert!(fetch_failed.is_some());

        extend_caa_or_record_error(
            Ok(vec![sample_candidate("https://caa.example/front.jpg")]),
            &mut candidates,
            &mut fetch_failed,
        );
        assert_eq!(candidates.len(), 1);
        assert!(fetch_failed.is_none());
    }

    #[test]
    #[ignore = "network"]
    fn head_content_length_fetches_real_size() {
        let client = reqwest::blocking::Client::builder()
            .user_agent(crate::USER_AGENT)
            .build()
            .unwrap();
        let url = "https://coverartarchive.org/release/da58fa17-c473-4da2-b424-fc4c4ef9345f/15993083208.jpg";
        let len = fetch_content_length(&client, url);
        assert!(len.is_some(), "expected Some length, got {len:?}");
        assert!(len.unwrap() > 1000, "expected >1KB, got {len:?}");
    }

    #[test]
    fn parse_content_range_total_extracts_size() {
        use reqwest::header::HeaderValue;
        let value = HeaderValue::from_static("bytes 0-0/77767");
        assert_eq!(parse_content_range_total(&value), Some(77767));
    }

    #[test]
    fn sorts_by_canonical_rank_then_file_size() {
        let mut items = vec![
            CoverArtCandidate {
                url: "b".into(),
                thumbnail_url: None,
                file_size: Some(500),
                width: None,
                height: None,
                canonical_rank: 1,
            },
            CoverArtCandidate {
                url: "a".into(),
                thumbnail_url: None,
                file_size: Some(100),
                width: None,
                height: None,
                canonical_rank: 1,
            },
            CoverArtCandidate {
                url: "c".into(),
                thumbnail_url: None,
                file_size: Some(50),
                width: None,
                height: None,
                canonical_rank: 0,
            },
        ];
        items.sort_by(|a, b| {
            a.canonical_rank.cmp(&b.canonical_rank).then_with(|| {
                a.file_size
                    .unwrap_or(u64::MAX)
                    .cmp(&b.file_size.unwrap_or(u64::MAX))
            })
        });
        assert_eq!(items[0].url, "c");
        assert_eq!(items[1].url, "a");
        assert_eq!(items[2].url, "b");
    }

    #[test]
    fn release_group_id_from_value_reads_nested_id() {
        let value = serde_json::json!({
            "id": "release-id",
            "release-group": { "id": "rg-id-123" }
        });
        assert_eq!(release_group_id_from_value(&value), Some("rg-id-123"));
        assert_eq!(
            release_group_id_from_value(&serde_json::json!({ "id": "release-id" })),
            None
        );
    }

    #[test]
    fn unique_release_group_mbids_dedupes_case_insensitively() {
        let releases = vec![
            serde_json::json!({ "release-group": { "id": "AAAA" } }),
            serde_json::json!({ "release-group": { "id": "aaaa" } }),
            serde_json::json!({ "release-group": { "id": "BBBB" } }),
            serde_json::json!({ "id": "no-rg" }),
        ];
        assert_eq!(
            unique_release_group_mbids(&releases),
            vec!["AAAA".to_string(), "BBBB".to_string()]
        );
    }

    #[test]
    fn includes_all_front_typed_images_not_only_primary_flag() {
        // Thriller Special Edition: two Front images, only one with front: true.
        let images = vec![
            serde_json::json!({
                "front": true,
                "types": ["Front"],
                "approved": true,
                "image": "https://caa.example/special-edition.jpg",
                "thumbnails": { "small": "https://caa.example/special-edition-250.jpg" }
            }),
            serde_json::json!({
                "front": false,
                "types": ["Front"],
                "approved": true,
                "image": "https://caa.example/original.jpg",
                "thumbnails": { "small": "https://caa.example/original-250.jpg" }
            }),
            serde_json::json!({
                "front": false,
                "types": ["Back", "Spine"],
                "approved": true,
                "image": "https://caa.example/back.jpg"
            }),
        ];

        let candidates = parse_caa_front_candidates(&images, 0);
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].url, "https://caa.example/special-edition.jpg");
        assert_eq!(candidates[1].url, "https://caa.example/original.jpg");
        assert!(candidates[0].canonical_rank < candidates[1].canonical_rank);
    }

    #[test]
    fn caa_image_is_front_uses_types_over_primary_flag() {
        assert!(caa_image_is_front(&serde_json::json!({
            "front": false,
            "types": ["Front"]
        })));
        assert!(!caa_image_is_front(&serde_json::json!({
            "front": false,
            "types": ["Back", "Spine"]
        })));
        assert!(caa_image_is_front(&serde_json::json!({
            "front": true,
            "types": []
        })));
    }

    #[test]
    fn release_group_rank_offset_keeps_release_art_first() {
        let release_art = CoverArtCandidate {
            url: "release".into(),
            thumbnail_url: None,
            file_size: Some(1000),
            width: None,
            height: None,
            canonical_rank: 999,
        };
        let mut group_art = CoverArtCandidate {
            url: "group".into(),
            thumbnail_url: None,
            file_size: Some(10),
            width: None,
            height: None,
            canonical_rank: 0,
        };
        apply_release_group_rank_offset(std::slice::from_mut(&mut group_art));

        let mut items = vec![group_art, release_art];
        sort_and_truncate_candidates(&mut items);
        assert_eq!(items[0].url, "release");
        assert_eq!(items[1].url, "group");
        assert!(items[1].canonical_rank >= RELEASE_GROUP_RANK_OFFSET);
    }
}
