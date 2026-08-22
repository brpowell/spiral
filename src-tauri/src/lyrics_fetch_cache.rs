//! On-disk cache for LRCLIB lyrics lookups keyed by artist + title + duration.

use std::collections::HashMap;
use std::fs;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::models::TrackLyricsInput;
use crate::settings;

const HIT_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);
/// Misses may resolve when LRCLIB gains a community upload days or weeks later.
/// Weekly backoff avoids hammering the API for tracks that genuinely have no lyrics.
const MISS_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// Instrumental is a positive LRCLIB classification — keep it as long as hits.
const INSTRUMENTAL_TTL: Duration = HIT_TTL;
const ERROR_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum CacheKind {
    Hit,
    Miss,
    Instrumental,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedLyricsEntry {
    fetched_at_ms: u64,
    kind: CacheKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    lyrics: Option<TrackLyricsInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LyricsFetchCacheFile {
    #[serde(default)]
    lookups: HashMap<String, CachedLyricsEntry>,
}

static CACHE: LazyLock<Mutex<Option<LyricsFetchCacheFile>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone, PartialEq)]
pub enum CachedLyricsLookup {
    NotCached,
    Miss,
    Instrumental,
    Hit(TrackLyricsInput),
}

pub fn cache_fingerprint(artist: &str, title: &str, duration_secs: u32) -> String {
    format!(
        "{}|{}|{duration_secs}",
        artist.trim().to_ascii_lowercase(),
        title.trim().to_ascii_lowercase(),
    )
}

fn cache_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(settings::app_data_dir(app)?.join("lyrics-fetch-cache.json"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn entry_fetched_at(entry: &CachedLyricsEntry) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(entry.fetched_at_ms)
}

fn ttl_for_kind(kind: CacheKind) -> Duration {
    match kind {
        CacheKind::Hit => HIT_TTL,
        CacheKind::Miss => MISS_TTL,
        CacheKind::Instrumental => INSTRUMENTAL_TTL,
        CacheKind::Error => ERROR_TTL,
    }
}

fn is_entry_valid(entry: &CachedLyricsEntry, now: SystemTime) -> bool {
    entry_fetched_at(entry)
        .checked_add(ttl_for_kind(entry.kind))
        .is_some_and(|expires_at| now < expires_at)
}

fn ensure_loaded(app: &AppHandle) -> Result<(), String> {
    let mut guard = CACHE.lock().map_err(|err| err.to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let path = cache_path(app)?;
    let mut file = if path.exists() {
        let contents = fs::read_to_string(&path)
            .map_err(|err| format!("failed to read lyrics fetch cache: {err}"))?;
        serde_json::from_str(&contents).unwrap_or_default()
    } else {
        LyricsFetchCacheFile::default()
    };

    let now = SystemTime::now();
    file.lookups.retain(|_, entry| is_entry_valid(entry, now));

    *guard = Some(file);
    Ok(())
}

fn persist_cache(app: &AppHandle, cache: &LyricsFetchCacheFile) -> Result<(), String> {
    let path = cache_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create app data directory: {err}"))?;
    }
    let json = serde_json::to_string_pretty(cache)
        .map_err(|err| format!("failed to serialize lyrics fetch cache: {err}"))?;
    fs::write(&path, json).map_err(|err| format!("failed to write lyrics fetch cache: {err}"))
}

fn with_cache_mut<R>(
    app: &AppHandle,
    f: impl FnOnce(&mut LyricsFetchCacheFile) -> Result<R, String>,
) -> Result<R, String> {
    ensure_loaded(app)?;
    let mut guard = CACHE.lock().map_err(|err| err.to_string())?;
    let cache = guard
        .as_mut()
        .ok_or_else(|| "lyrics fetch cache not initialized".to_string())?;
    let result = f(cache)?;
    persist_cache(app, cache)?;
    Ok(result)
}

pub fn get_cached_lookup(app: &AppHandle, fingerprint: &str) -> Result<CachedLyricsLookup, String> {
    ensure_loaded(app)?;
    let guard = CACHE.lock().map_err(|err| err.to_string())?;
    let Some(cache) = guard.as_ref() else {
        return Ok(CachedLyricsLookup::NotCached);
    };
    let Some(entry) = cache.lookups.get(fingerprint) else {
        return Ok(CachedLyricsLookup::NotCached);
    };
    if !is_entry_valid(entry, SystemTime::now()) {
        return Ok(CachedLyricsLookup::NotCached);
    }

    match entry.kind {
        CacheKind::Hit => {
            if let Some(lyrics) = entry.lyrics.clone() {
                Ok(CachedLyricsLookup::Hit(lyrics))
            } else {
                Ok(CachedLyricsLookup::NotCached)
            }
        }
        CacheKind::Miss => Ok(CachedLyricsLookup::Miss),
        CacheKind::Instrumental => Ok(CachedLyricsLookup::Instrumental),
        CacheKind::Error => Ok(CachedLyricsLookup::NotCached),
    }
}

pub fn store_cached_hit(
    app: &AppHandle,
    fingerprint: String,
    lyrics: TrackLyricsInput,
) -> Result<(), String> {
    with_cache_mut(app, |cache| {
        cache.lookups.insert(
            fingerprint,
            CachedLyricsEntry {
                fetched_at_ms: now_ms(),
                kind: CacheKind::Hit,
                lyrics: Some(lyrics),
            },
        );
        Ok(())
    })
}

pub fn store_cached_miss(app: &AppHandle, fingerprint: String) -> Result<(), String> {
    with_cache_mut(app, |cache| {
        cache.lookups.insert(
            fingerprint,
            CachedLyricsEntry {
                fetched_at_ms: now_ms(),
                kind: CacheKind::Miss,
                lyrics: None,
            },
        );
        Ok(())
    })
}

pub fn store_cached_instrumental(app: &AppHandle, fingerprint: String) -> Result<(), String> {
    with_cache_mut(app, |cache| {
        cache.lookups.insert(
            fingerprint,
            CachedLyricsEntry {
                fetched_at_ms: now_ms(),
                kind: CacheKind::Instrumental,
                lyrics: None,
            },
        );
        Ok(())
    })
}

pub fn store_cached_error(app: &AppHandle, fingerprint: String) -> Result<(), String> {
    with_cache_mut(app, |cache| {
        cache.lookups.insert(
            fingerprint,
            CachedLyricsEntry {
                fetched_at_ms: now_ms(),
                kind: CacheKind::Error,
                lyrics: None,
            },
        );
        Ok(())
    })
}

pub fn clear_lookup_cache(app: &AppHandle) -> Result<(), String> {
    let mut guard = CACHE.lock().map_err(|err| err.to_string())?;
    *guard = Some(LyricsFetchCacheFile::default());
    persist_cache(app, guard.as_ref().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_fingerprint_normalizes_whitespace_and_case() {
        assert_eq!(
            cache_fingerprint("  Artist  ", "Title", 233),
            "artist|title|233"
        );
    }

    #[test]
    fn miss_entries_expire_after_miss_ttl() {
        let entry = CachedLyricsEntry {
            fetched_at_ms: now_ms(),
            kind: CacheKind::Miss,
            lyrics: None,
        };
        assert!(is_entry_valid(&entry, SystemTime::now()));
        let expired_at = entry_fetched_at(&entry) + MISS_TTL + Duration::from_secs(1);
        assert!(!is_entry_valid(&entry, expired_at));
    }

    #[test]
    fn miss_entries_outlive_error_entries() {
        let entry = CachedLyricsEntry {
            fetched_at_ms: now_ms(),
            kind: CacheKind::Miss,
            lyrics: None,
        };
        let after_error_ttl = entry_fetched_at(&entry) + ERROR_TTL + Duration::from_secs(1);
        assert!(is_entry_valid(&entry, after_error_ttl));
    }
}
