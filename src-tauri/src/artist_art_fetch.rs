use crate::cover_art_fetch::CoverArtCandidate;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime};

const DEEZER_USER_AGENT: &str = "Spiral/0.1.0 (https://github.com/brpowell/spiral)";
const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_RESULTS: usize = 12;

#[derive(Clone)]
struct CacheEntry {
    fetched_at: SystemTime,
    candidates: Vec<CoverArtCandidate>,
}

static FETCH_CACHE: LazyLock<Mutex<HashMap<String, CacheEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn fetch_artist_art_cached(artist: String) -> Result<Vec<CoverArtCandidate>, String> {
    let trimmed = artist.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let key = cache_key(trimmed);
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

    let candidates = fetch_artist_art_uncached(trimmed)?;
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

fn cache_key(artist: &str) -> String {
    format!("artist|{}", artist.to_ascii_lowercase())
}

fn prune_expired() {
    let Ok(mut cache) = FETCH_CACHE.lock() else {
        return;
    };
    cache.retain(|_, entry| entry.fetched_at.elapsed().unwrap_or(CACHE_TTL) < CACHE_TTL);
}

fn fetch_artist_art_uncached(artist: &str) -> Result<Vec<CoverArtCandidate>, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(DEEZER_USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;

    let search_url = format!(
        "https://api.deezer.com/search/artist?q={}",
        urlencoding_simple(artist)
    );

    let search: serde_json::Value = match client.get(&search_url).send() {
        Ok(resp) if resp.status().is_success() => resp.json().unwrap_or(serde_json::Value::Null),
        _ => return Ok(vec![]),
    };

    let artists = search
        .get("data")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();

    let mut candidates = Vec::new();

    for (idx, entry) in artists.iter().enumerate() {
        let Some(url) = entry
            .get("picture_xl")
            .or_else(|| entry.get("picture_big"))
            .or_else(|| entry.get("picture"))
            .and_then(|u| u.as_str())
            .filter(|u| !u.is_empty() && !u.contains("artist//"))
        else {
            continue;
        };

        if candidates.iter().any(|c: &CoverArtCandidate| c.url == url) {
            continue;
        }

        let thumbnail_url = entry
            .get("picture_medium")
            .or_else(|| entry.get("picture_small"))
            .and_then(|u| u.as_str())
            .filter(|u| !u.is_empty() && !u.contains("artist//"))
            .map(str::to_string);

        let (width, height) = match dimensions_from_deezer_url(url) {
            Some((w, h)) => (Some(w), Some(h)),
            None => (None, None),
        };

        candidates.push(CoverArtCandidate {
            url: url.to_string(),
            thumbnail_url,
            file_size: None,
            width,
            height,
            canonical_rank: u32::try_from(idx).unwrap_or(u32::MAX),
        });
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

fn enrich_candidates(client: &reqwest::blocking::Client, candidates: &mut [CoverArtCandidate]) {
    for candidate in candidates.iter_mut() {
        if candidate.width.is_none() || candidate.height.is_none() {
            if let Some((w, h)) = dimensions_from_deezer_url(&candidate.url) {
                candidate.width = Some(w);
                candidate.height = Some(h);
            }
        }

        if candidate.file_size.is_none() {
            candidate.file_size = fetch_content_length(client, &candidate.url);
        }
    }
}

fn dimensions_from_deezer_url(url: &str) -> Option<(u32, u32)> {
    for size in [1000u32, 500, 250] {
        let needle = format!("{size}x{size}");
        if url.contains(&needle) {
            return Some((size, size));
        }
    }
    None
}

fn fetch_content_length(client: &reqwest::blocking::Client, url: &str) -> Option<u64> {
    client
        .head(url)
        .send()
        .ok()
        .filter(|r| r.status().is_success())
        .and_then(|r| r.content_length())
        .filter(|len| *len > 0)
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
    fn dimensions_from_deezer_url_parses_size_hint() {
        let url = "https://cdn-images.dzcdn.net/images/artist/abc/500x500-000000-80-0-0.jpg";
        assert_eq!(dimensions_from_deezer_url(url), Some((500, 500)));
    }

    #[test]
    fn skips_blank_deezer_placeholder_urls() {
        let entry = serde_json::json!({
            "picture_xl": "https://api.deezer.com/artist//image",
            "picture_big": "https://cdn-images.dzcdn.net/images/artist/abc/500x500-000000-80-0-0.jpg"
        });
        let url = entry
            .get("picture_xl")
            .and_then(|u| u.as_str())
            .filter(|u| !u.is_empty() && !u.contains("artist//"));
        assert!(url.is_none());
    }
}
