use serde::Serialize;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime};

const MUSICBRAINZ_USER_AGENT: &str = "Spiral/0.1.0 (https://github.com/brpowell/spiral)";
const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_RESULTS: usize = 12;

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

pub fn fetch_cover_art_cached(artist: String, album: String) -> Result<Vec<CoverArtCandidate>, String> {
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
            return Ok(entry.candidates);
        }
    }

    let candidates = fetch_cover_art_uncached(&artist, &album)?;
    let fetched_at = SystemTime::now();

    FETCH_CACHE
        .lock()
        .map_err(|e| e.to_string())?
        .insert(
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
        "v3|{}|{}",
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

fn fetch_cover_art_uncached(artist: &str, album: &str) -> Result<Vec<CoverArtCandidate>, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(MUSICBRAINZ_USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;

    let query = format!(
        "release:\"{}\" AND artist:\"{}\"",
        album.replace('"', "\\\""),
        artist.replace('"', "\\\"")
    );
    let search_url = format!(
        "https://musicbrainz.org/ws/2/release?query={}&fmt=json&limit=5",
        urlencoding_simple(&query)
    );

    let search: serde_json::Value = match client.get(&search_url).send() {
        Ok(resp) if resp.status().is_success() => resp.json().unwrap_or(serde_json::Value::Null),
        _ => return Ok(vec![]),
    };

    let releases = search
        .get("releases")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    let mut candidates = Vec::new();

    for (release_idx, release) in releases.iter().enumerate() {
        let Some(mbid) = release.get("id").and_then(|id| id.as_str()) else {
            continue;
        };

        let caa_url = format!("https://coverartarchive.org/release/{mbid}");
        let caa: serde_json::Value = match client.get(&caa_url).send() {
            Ok(resp) if resp.status().is_success() => {
                resp.json().unwrap_or(serde_json::Value::Null)
            }
            _ => continue,
        };

        let Some(images) = caa.get("images").and_then(|i| i.as_array()) else {
            continue;
        };

        for (image_idx, image) in images.iter().enumerate() {
            let types = image
                .get("types")
                .and_then(|t| t.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>())
                .unwrap_or_default();

            let is_front = image
                .get("front")
                .and_then(|f| f.as_bool())
                .unwrap_or_else(|| {
                    types.iter().any(|t| t.eq_ignore_ascii_case("front")) || types.is_empty()
                });

            if !is_front {
                continue;
            }

            let Some(url) = image.get("image").and_then(|u| u.as_str()) else {
                continue;
            };

            if candidates.iter().any(|c: &CoverArtCandidate| c.url == url) {
                continue;
            }

            let approved = image.get("approved").and_then(|a| a.as_bool()).unwrap_or(true);
            let mut canonical_rank =
                u32::try_from(release_idx).unwrap_or(u32::MAX) * 1000
                    + u32::try_from(image_idx).unwrap_or(u32::MAX);
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
    }

    enrich_candidates(&client, &mut candidates);

    candidates.sort_by(|a, b| {
        a.canonical_rank
            .cmp(&b.canonical_rank)
            .then_with(|| {
                a.file_size
                    .unwrap_or(u64::MAX)
                    .cmp(&b.file_size.unwrap_or(u64::MAX))
            })
    });

    candidates.truncate(MAX_RESULTS);
    Ok(candidates)
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
    let response = client
        .get(url)
        .header("Range", "bytes=0-0")
        .send()
        .ok()?;

    if let Some(total) = parse_content_range_total(response.headers().get("content-range")?) {
        return Some(total);
    }

    response
        .content_length()
        .filter(|len| *len > 0)
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
    #[ignore = "network"]
    fn head_content_length_fetches_real_size() {
        let client = reqwest::blocking::Client::builder()
            .user_agent(MUSICBRAINZ_USER_AGENT)
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
            a.canonical_rank
                .cmp(&b.canonical_rank)
                .then_with(|| {
                    a.file_size
                        .unwrap_or(u64::MAX)
                        .cmp(&b.file_size.unwrap_or(u64::MAX))
                })
        });
        assert_eq!(items[0].url, "c");
        assert_eq!(items[1].url, "a");
        assert_eq!(items[2].url, "b");
    }
}
