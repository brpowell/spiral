//! Disc-ID-keyed MusicBrainz lookup cache and per-disc release preferences.

use std::collections::HashMap;
use std::fs;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::activity_log::{self, LogLevel};
use crate::musicbrainz_disc::{self, DiscMetadata, DiscMetadataLookup, LookupCacheKind};
use crate::settings;

const HIT_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const MISS_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const ERROR_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum CacheKind {
    Hit,
    Miss,
    Error,
}

impl From<LookupCacheKind> for CacheKind {
    fn from(kind: LookupCacheKind) -> Self {
        match kind {
            LookupCacheKind::Hit => Self::Hit,
            LookupCacheKind::Miss => Self::Miss,
            LookupCacheKind::Error => Self::Error,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedLookupEntry {
    fetched_at_ms: u64,
    kind: CacheKind,
    lookup: DiscMetadataLookup,
}

/// Per-track user edits for a disc (pre-import plan), keyed by track number.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscTrackOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rating: Option<u8>,
}

/// User metadata overrides for a disc, independent of MusicBrainz / library.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscMetadataOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album_artist: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub art_path: Option<String>,
    /// Track number (as decimal string) → field overrides.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub tracks: HashMap<String, DiscTrackOverride>,
}

impl DiscMetadataOverride {
    pub fn is_empty(&self) -> bool {
        self.album.is_none()
            && self.album_artist.is_none()
            && self.year.is_none()
            && self.genre.is_none()
            && self.art_path.is_none()
            && self.tracks.is_empty()
    }

    /// Deep-merge `patch` onto `self` (patch wins for set fields; track maps merge).
    pub fn merge_patch(&mut self, patch: &DiscMetadataOverride) {
        if patch.album.is_some() {
            self.album = patch.album.clone();
        }
        if patch.album_artist.is_some() {
            self.album_artist = patch.album_artist.clone();
        }
        if patch.year.is_some() {
            self.year = patch.year;
        }
        if patch.genre.is_some() {
            self.genre = patch.genre.clone();
        }
        if patch.art_path.is_some() {
            self.art_path = patch.art_path.clone();
        }
        for (number, track_patch) in &patch.tracks {
            let entry = self.tracks.entry(number.clone()).or_default();
            if track_patch.title.is_some() {
                entry.title = track_patch.title.clone();
            }
            if track_patch.artist.is_some() {
                entry.artist = track_patch.artist.clone();
            }
            if track_patch.rating.is_some() {
                entry.rating = track_patch.rating;
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DiscMetadataCacheFile {
    #[serde(default)]
    lookups: HashMap<String, CachedLookupEntry>,
    #[serde(default)]
    preferences: HashMap<String, String>,
    #[serde(default)]
    overrides: HashMap<String, DiscMetadataOverride>,
}

static CACHE: LazyLock<Mutex<Option<DiscMetadataCacheFile>>> = LazyLock::new(|| Mutex::new(None));

fn cache_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(settings::app_data_dir(app)?.join("disc-metadata-cache.json"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn entry_fetched_at(entry: &CachedLookupEntry) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(entry.fetched_at_ms)
}

fn ttl_for_kind(kind: CacheKind) -> Duration {
    match kind {
        CacheKind::Hit => HIT_TTL,
        CacheKind::Miss => MISS_TTL,
        CacheKind::Error => ERROR_TTL,
    }
}

fn is_entry_valid(entry: &CachedLookupEntry, now: SystemTime) -> bool {
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
            .map_err(|err| format!("failed to read disc metadata cache: {err}"))?;
        serde_json::from_str(&contents).unwrap_or_default()
    } else {
        DiscMetadataCacheFile::default()
    };

    let now = SystemTime::now();
    file.lookups.retain(|_, entry| is_entry_valid(entry, now));

    *guard = Some(file);
    Ok(())
}

fn with_cache_mut<R>(
    app: &AppHandle,
    f: impl FnOnce(&mut DiscMetadataCacheFile) -> Result<R, String>,
) -> Result<R, String> {
    ensure_loaded(app)?;
    let mut guard = CACHE.lock().map_err(|err| err.to_string())?;
    let cache = guard
        .as_mut()
        .ok_or_else(|| "disc metadata cache not initialized".to_string())?;
    let result = f(cache)?;
    persist_cache(app, cache)?;
    Ok(result)
}

fn persist_cache(app: &AppHandle, cache: &DiscMetadataCacheFile) -> Result<(), String> {
    let path = cache_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create app data directory: {err}"))?;
    }
    let json = serde_json::to_string_pretty(cache)
        .map_err(|err| format!("failed to serialize disc metadata cache: {err}"))?;
    fs::write(&path, json).map_err(|err| format!("failed to write disc metadata cache: {err}"))
}

fn resolve_preferred(
    lookup: &DiscMetadataLookup,
    preference_mbid: Option<&str>,
) -> Option<DiscMetadata> {
    let release_mbid = preference_mbid?;
    lookup
        .candidates
        .iter()
        .find(|candidate| candidate.release_mbid.as_deref() == Some(release_mbid))
        .cloned()
}

fn lookup_with_preference(
    mut lookup: DiscMetadataLookup,
    preference_mbid: Option<&str>,
) -> DiscMetadataLookup {
    lookup.preferred = resolve_preferred(&lookup, preference_mbid);
    lookup
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscMetadataCachePeek {
    pub lookup: DiscMetadataLookup,
    pub needs_network_fetch: bool,
}

fn empty_lookup(disc_id: Option<&str>) -> DiscMetadataLookup {
    DiscMetadataLookup {
        disc_id: disc_id.map(str::to_string),
        candidates: Vec::new(),
        preferred: None,
    }
}

fn preference_mbid_for_disc(app: &AppHandle, disc_id: &str) -> Result<Option<String>, String> {
    ensure_loaded(app)?;
    let guard = CACHE.lock().map_err(|err| err.to_string())?;
    Ok(guard
        .as_ref()
        .and_then(|cache| cache.preferences.get(disc_id).cloned()))
}

fn should_serve_cached_entry(entry: &CachedLookupEntry) -> bool {
    match entry.kind {
        CacheKind::Hit => !entry.lookup.candidates.is_empty(),
        // A miss with zero candidates means MusicBrainz has no match — don't retry every load.
        CacheKind::Miss => true,
        // Transient failures should be retried instead of blocking lookups.
        CacheKind::Error => false,
    }
}

fn cached_lookup_entry(disc_id: &str) -> Result<Option<CachedLookupEntry>, String> {
    let guard = CACHE.lock().map_err(|err| err.to_string())?;
    Ok(guard
        .as_ref()
        .and_then(|cache| cache.lookups.get(disc_id).cloned()))
}

/// Read the on-disk cache only; never contacts MusicBrainz.
pub fn peek_disc_metadata_cache(
    app: &AppHandle,
    tracks: &[(u32, f64)],
) -> Result<DiscMetadataCachePeek, String> {
    if tracks.is_empty() {
        activity_log::log(
            LogLevel::Debug,
            "metadata.musicbrainz",
            "Cache peek skipped: empty track list",
            None,
        );
        return Ok(DiscMetadataCachePeek {
            lookup: empty_lookup(None),
            needs_network_fetch: false,
        });
    }

    let disc_id = crate::cd::disc_id::compute_disc_id(tracks);
    let preference_mbid = preference_mbid_for_disc(app, &disc_id)?;

    if let Some(cached) = cached_lookup_entry(&disc_id)? {
        if is_entry_valid(&cached, SystemTime::now()) && should_serve_cached_entry(&cached) {
            let candidate_count = cached.lookup.candidates.len();
            activity_log::log(
                LogLevel::Info,
                "metadata.musicbrainz",
                format!("Cache peek hit for disc {disc_id}"),
                Some(serde_json::json!({
                    "discId": disc_id,
                    "cacheKind": cached.kind,
                    "candidateCount": candidate_count,
                    "trackCount": tracks.len(),
                })),
            );
            return Ok(DiscMetadataCachePeek {
                lookup: lookup_with_preference(cached.lookup, preference_mbid.as_deref()),
                needs_network_fetch: false,
            });
        }

        if is_entry_valid(&cached, SystemTime::now()) {
            activity_log::log(
                LogLevel::Info,
                "metadata.musicbrainz",
                format!("Cache peek skipped unusable entry for disc {disc_id}"),
                Some(serde_json::json!({
                    "discId": disc_id,
                    "cacheKind": cached.kind,
                    "candidateCount": cached.lookup.candidates.len(),
                    "trackCount": tracks.len(),
                })),
            );
        } else {
            activity_log::log(
                LogLevel::Info,
                "metadata.musicbrainz",
                format!("Cache peek stale for disc {disc_id}"),
                Some(serde_json::json!({
                    "discId": disc_id,
                    "cacheKind": cached.kind,
                    "trackCount": tracks.len(),
                })),
            );
        }
    } else {
        activity_log::log(
            LogLevel::Info,
            "metadata.musicbrainz",
            format!("Cache peek miss for disc {disc_id}"),
            Some(serde_json::json!({
                "discId": disc_id,
                "trackCount": tracks.len(),
            })),
        );
    }

    Ok(DiscMetadataCachePeek {
        lookup: empty_lookup(Some(&disc_id)),
        needs_network_fetch: true,
    })
}

pub fn lookup_disc_metadata_cached_with_options(
    app: &AppHandle,
    tracks: &[(u32, f64)],
    force_refresh: bool,
) -> Result<DiscMetadataLookup, String> {
    if tracks.is_empty() {
        activity_log::log(
            LogLevel::Debug,
            "metadata.musicbrainz",
            "Lookup skipped: empty track list",
            None,
        );
        return Ok(empty_lookup(None));
    }

    let disc_id = crate::cd::disc_id::compute_disc_id(tracks);
    ensure_loaded(app)?;

    let preference_mbid = preference_mbid_for_disc(app, &disc_id)?;

    if !force_refresh {
        if let Some(cached) = cached_lookup_entry(&disc_id)? {
            if is_entry_valid(&cached, SystemTime::now()) && should_serve_cached_entry(&cached) {
                activity_log::log(
                    LogLevel::Info,
                    "metadata.musicbrainz",
                    format!("Lookup served from cache for disc {disc_id}"),
                    Some(serde_json::json!({
                        "discId": disc_id,
                        "cacheKind": cached.kind,
                        "candidateCount": cached.lookup.candidates.len(),
                        "forceRefresh": false,
                    })),
                );
                return Ok(lookup_with_preference(
                    cached.lookup,
                    preference_mbid.as_deref(),
                ));
            }
        }
    } else {
        activity_log::log(
            LogLevel::Info,
            "metadata.musicbrainz",
            format!("Force refresh requested for disc {disc_id}"),
            Some(serde_json::json!({ "discId": disc_id })),
        );
    }

    activity_log::log(
        LogLevel::Info,
        "metadata.musicbrainz",
        format!("Fetching metadata from MusicBrainz for disc {disc_id}"),
        Some(serde_json::json!({
            "discId": disc_id,
            "trackCount": tracks.len(),
            "forceRefresh": force_refresh,
        })),
    );

    let (lookup, kind) = musicbrainz_disc::fetch_disc_metadata(tracks);
    let lookup = with_cache_mut(app, |cache| {
        cache.lookups.insert(
            disc_id.clone(),
            CachedLookupEntry {
                fetched_at_ms: now_ms(),
                kind: kind.into(),
                lookup: lookup.clone(),
            },
        );
        Ok(lookup)
    })?;

    activity_log::log(
        LogLevel::Info,
        "metadata.musicbrainz",
        format!("Lookup cached for disc {disc_id}"),
        Some(serde_json::json!({
            "discId": disc_id,
            "cacheKind": match kind {
                LookupCacheKind::Hit => "hit",
                LookupCacheKind::Miss => "miss",
                LookupCacheKind::Error => "error",
            },
            "candidateCount": lookup.candidates.len(),
        })),
    );

    Ok(lookup_with_preference(lookup, preference_mbid.as_deref()))
}

fn clear_lookups(cache: &mut DiscMetadataCacheFile) -> u32 {
    let count = u32::try_from(cache.lookups.len()).unwrap_or(u32::MAX);
    cache.lookups.clear();
    count
}

pub fn clear_lookup_cache(app: &AppHandle) -> Result<(), String> {
    with_cache_mut(app, |cache| {
        clear_lookups(cache);
        Ok(())
    })
}

pub fn save_disc_metadata_preference(
    app: &AppHandle,
    disc_id: &str,
    release_mbid: &str,
) -> Result<(), String> {
    if disc_id.trim().is_empty() || release_mbid.trim().is_empty() {
        return Err("disc id and release mbid are required".to_string());
    }

    with_cache_mut(app, |cache| {
        cache
            .preferences
            .insert(disc_id.to_string(), release_mbid.to_string());
        Ok(())
    })?;

    activity_log::log(
        LogLevel::Info,
        "metadata.musicbrainz",
        format!("Saved release preference for disc {disc_id}"),
        Some(serde_json::json!({
            "discId": disc_id,
            "releaseMbid": release_mbid,
        })),
    );

    Ok(())
}

pub fn get_disc_metadata_override(
    app: &AppHandle,
    disc_id: &str,
) -> Result<Option<DiscMetadataOverride>, String> {
    if disc_id.trim().is_empty() {
        return Err("disc id is required".to_string());
    }
    ensure_loaded(app)?;
    let guard = CACHE.lock().map_err(|err| err.to_string())?;
    Ok(guard
        .as_ref()
        .and_then(|cache| cache.overrides.get(disc_id).cloned())
        .filter(|override_| !override_.is_empty()))
}

pub fn save_disc_metadata_override(
    app: &AppHandle,
    disc_id: &str,
    patch: DiscMetadataOverride,
) -> Result<DiscMetadataOverride, String> {
    if disc_id.trim().is_empty() {
        return Err("disc id is required".to_string());
    }

    let saved = with_cache_mut(app, |cache| {
        let entry = cache.overrides.entry(disc_id.to_string()).or_default();
        entry.merge_patch(&patch);
        if entry.is_empty() {
            cache.overrides.remove(disc_id);
            Ok(DiscMetadataOverride::default())
        } else {
            Ok(entry.clone())
        }
    })?;

    activity_log::log(
        LogLevel::Info,
        "metadata.musicbrainz",
        format!("Saved metadata override for disc {disc_id}"),
        Some(serde_json::json!({
            "discId": disc_id,
            "empty": saved.is_empty(),
            "trackOverrideCount": saved.tracks.len(),
        })),
    );

    Ok(saved)
}

pub fn clear_disc_metadata_override(app: &AppHandle, disc_id: &str) -> Result<(), String> {
    if disc_id.trim().is_empty() {
        return Err("disc id is required".to_string());
    }

    with_cache_mut(app, |cache| {
        cache.overrides.remove(disc_id);
        Ok(())
    })?;

    activity_log::log(
        LogLevel::Info,
        "metadata.musicbrainz",
        format!("Cleared metadata override for disc {disc_id}"),
        Some(serde_json::json!({ "discId": disc_id })),
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_lookup(disc_id: &str, album: &str) -> DiscMetadataLookup {
        DiscMetadataLookup {
            disc_id: Some(disc_id.to_string()),
            candidates: vec![DiscMetadata {
                disc_id: Some(disc_id.to_string()),
                album: Some(album.to_string()),
                album_artist: Some("Artist".to_string()),
                year: Some(1999),
                genre: None,
                country: None,
                label: None,
                release_mbid: Some("release-1".to_string()),
                tracks: vec![],
            }],
            preferred: None,
        }
    }

    #[test]
    fn hit_entries_expire_after_hit_ttl() {
        let entry = CachedLookupEntry {
            fetched_at_ms: now_ms(),
            kind: CacheKind::Hit,
            lookup: sample_lookup("disc-a", "Album"),
        };
        assert!(is_entry_valid(&entry, SystemTime::now()));
        let expired_at = entry_fetched_at(&entry) + HIT_TTL + Duration::from_secs(1);
        assert!(!is_entry_valid(&entry, expired_at));
    }

    #[test]
    fn error_entries_expire_sooner_than_hits() {
        let entry = CachedLookupEntry {
            fetched_at_ms: now_ms(),
            kind: CacheKind::Error,
            lookup: sample_lookup("disc-a", "Album"),
        };
        let after_error_ttl = entry_fetched_at(&entry) + ERROR_TTL + Duration::from_secs(1);
        assert!(!is_entry_valid(&entry, after_error_ttl));
        assert!(is_entry_valid(
            &entry,
            entry_fetched_at(&entry) + ERROR_TTL - Duration::from_secs(1)
        ));
    }

    #[test]
    fn resolve_preferred_matches_release_mbid() {
        let lookup = sample_lookup("disc-a", "Album");
        let preferred = resolve_preferred(&lookup, Some("release-1"));
        assert_eq!(
            preferred.and_then(|meta| meta.album),
            Some("Album".to_string())
        );
        assert!(resolve_preferred(&lookup, Some("missing")).is_none());
    }

    #[test]
    fn clear_lookups_preserves_preferences_and_overrides() {
        let mut cache = DiscMetadataCacheFile::default();
        cache.lookups.insert(
            "disc-a".to_string(),
            CachedLookupEntry {
                fetched_at_ms: now_ms(),
                kind: CacheKind::Hit,
                lookup: sample_lookup("disc-a", "Album"),
            },
        );
        cache
            .preferences
            .insert("disc-a".to_string(), "release-1".to_string());
        cache.overrides.insert(
            "disc-a".to_string(),
            DiscMetadataOverride {
                album: Some("Edited".to_string()),
                ..Default::default()
            },
        );

        let cleared = clear_lookups(&mut cache);

        assert_eq!(cleared, 1);
        assert!(cache.lookups.is_empty());
        assert_eq!(
            cache.preferences.get("disc-a"),
            Some(&"release-1".to_string())
        );
        assert_eq!(
            cache
                .overrides
                .get("disc-a")
                .and_then(|o| o.album.as_deref()),
            Some("Edited")
        );
    }

    #[test]
    fn merge_patch_merges_album_and_tracks() {
        let mut base = DiscMetadataOverride {
            album: Some("A".to_string()),
            tracks: HashMap::from([(
                "1".to_string(),
                DiscTrackOverride {
                    title: Some("T1".to_string()),
                    artist: None,
                    rating: Some(128),
                },
            )]),
            ..Default::default()
        };
        let patch = DiscMetadataOverride {
            album_artist: Some("Artist".to_string()),
            tracks: HashMap::from([(
                "1".to_string(),
                DiscTrackOverride {
                    title: Some("T1b".to_string()),
                    artist: Some("Solo".to_string()),
                    rating: None,
                },
            )]),
            ..Default::default()
        };
        base.merge_patch(&patch);
        assert_eq!(base.album.as_deref(), Some("A"));
        assert_eq!(base.album_artist.as_deref(), Some("Artist"));
        let track = base.tracks.get("1").unwrap();
        assert_eq!(track.title.as_deref(), Some("T1b"));
        assert_eq!(track.artist.as_deref(), Some("Solo"));
        assert_eq!(track.rating, Some(128));
    }

    #[test]
    fn should_serve_cached_entry_skips_errors_and_empty_hits() {
        let hit = CachedLookupEntry {
            fetched_at_ms: now_ms(),
            kind: CacheKind::Hit,
            lookup: sample_lookup("disc-a", "Album"),
        };
        assert!(should_serve_cached_entry(&hit));

        let empty_hit = CachedLookupEntry {
            fetched_at_ms: now_ms(),
            kind: CacheKind::Hit,
            lookup: empty_lookup(Some("disc-a")),
        };
        assert!(!should_serve_cached_entry(&empty_hit));

        let miss = CachedLookupEntry {
            fetched_at_ms: now_ms(),
            kind: CacheKind::Miss,
            lookup: empty_lookup(Some("disc-a")),
        };
        assert!(should_serve_cached_entry(&miss));

        let error = CachedLookupEntry {
            fetched_at_ms: now_ms(),
            kind: CacheKind::Error,
            lookup: empty_lookup(Some("disc-a")),
        };
        assert!(!should_serve_cached_entry(&error));
    }
}
