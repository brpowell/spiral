//! Per-drive session state: operation phase, detail-view pin, and presence cache.
#![cfg(target_os = "macos")]

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

pub const STATUS_CACHE_TTL: Duration = Duration::from_secs(4);
pub const PRESENCE_CACHE_TTL: Duration = Duration::from_secs(8);

/// What the app is doing with a drive. Drives monitor/mutual-exclusion behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriveSessionPhase {
    Idle,
    ReadingMetadata,
    Playing,
    Ejecting,
    Ripping,
}

impl DriveSessionPhase {
    fn blocks_monitor(self) -> bool {
        !matches!(self, DriveSessionPhase::Idle)
    }
}

#[derive(Debug)]
struct CachedDriveStatus {
    has_audio_cd: Option<bool>,
    volume_path: Option<String>,
    had_successful_read: bool,
    updated_at: Instant,
}

impl CachedDriveStatus {
    fn new_stale() -> Self {
        Self {
            has_audio_cd: None,
            volume_path: None,
            had_successful_read: false,
            updated_at: Instant::now() - STATUS_CACHE_TTL * 2,
        }
    }
}

#[derive(Debug)]
struct DriveSession {
    phase: DriveSessionPhase,
    detail_view_open: bool,
    cache: CachedDriveStatus,
}

impl DriveSession {
    fn new() -> Self {
        Self {
            phase: DriveSessionPhase::Idle,
            detail_view_open: false,
            cache: CachedDriveStatus::new_stale(),
        }
    }
}

struct DriveSessionStore {
    drives: HashMap<String, DriveSession>,
}

impl DriveSessionStore {
    fn entry_mut(&mut self, drive_id: &str) -> &mut DriveSession {
        self.drives
            .entry(drive_id.to_string())
            .or_insert_with(DriveSession::new)
    }
}

static SESSIONS: LazyLock<Mutex<DriveSessionStore>> =
    LazyLock::new(|| Mutex::new(DriveSessionStore { drives: HashMap::new() }));

fn with_sessions<R>(f: impl FnOnce(&mut DriveSessionStore) -> R) -> R {
    let mut guard = SESSIONS.lock().expect("drive sessions poisoned");
    f(&mut guard)
}

/// True while any drive has a user-facing read or eject in progress.
pub fn is_any_drive_busy() -> bool {
    with_sessions(|store| {
        store
            .drives
            .values()
            .any(|session| session.phase.blocks_monitor())
    })
}

pub fn set_detail_view_drive(drive_id: Option<&str>) {
    with_sessions(|store| {
        for session in store.drives.values_mut() {
            session.detail_view_open = false;
        }
        if let Some(id) = drive_id {
            store.entry_mut(id).detail_view_open = true;
        }
    });
}

pub fn should_skip_monitor_probe(drive_id: &str) -> bool {
    with_sessions(|store| {
        let Some(session) = store.drives.get(drive_id) else {
            return false;
        };
        session.detail_view_open
            && cached_has_audio_cd(&session.cache, PRESENCE_CACHE_TTL) == Some(true)
    })
}

pub fn cached_disc_presence(drive_id: &str) -> Option<bool> {
    with_sessions(|store| {
        store
            .drives
            .get(drive_id)
            .and_then(|session| cached_has_audio_cd(&session.cache, PRESENCE_CACHE_TTL))
    })
}

fn cached_has_audio_cd(cache: &CachedDriveStatus, ttl: Duration) -> Option<bool> {
    if cache.updated_at.elapsed() <= ttl {
        cache.has_audio_cd
    } else {
        None
    }
}

fn with_status_cache<R>(drive_id: &str, f: impl FnOnce(&mut CachedDriveStatus) -> R) -> R {
    with_sessions(|store| {
        let session = store.entry_mut(drive_id);
        f(&mut session.cache)
    })
}

pub fn cached_volume_path(drive_id: &str) -> Option<String> {
    with_status_cache(drive_id, |cache| {
        if cache.updated_at.elapsed() <= STATUS_CACHE_TTL {
            cache.volume_path.clone()
        } else {
            None
        }
    })
}

pub fn update_status_cache(
    drive_id: &str,
    has_audio_cd: Option<bool>,
    volume_path: Option<String>,
) {
    with_status_cache(drive_id, |cache| {
        if let Some(has_disc) = has_audio_cd {
            cache.has_audio_cd = Some(has_disc);
        }
        if volume_path.is_some() {
            cache.volume_path = volume_path;
        }
        cache.updated_at = Instant::now();
    });
}

pub fn mark_drive_read_success(drive_id: &str) {
    with_status_cache(drive_id, |cache| {
        cache.had_successful_read = true;
        cache.updated_at = Instant::now();
    });
}

pub fn drive_had_successful_read(drive_id: &str) -> bool {
    with_status_cache(drive_id, |cache| cache.had_successful_read)
}

pub fn cached_has_audio_cd_for_drive(drive_id: &str, ttl: Duration) -> Option<bool> {
    with_sessions(|store| {
        store
            .drives
            .get(drive_id)
            .and_then(|session| cached_has_audio_cd(&session.cache, ttl))
    })
}

pub fn is_read_in_progress(drive_id: &str) -> bool {
    with_sessions(|store| {
        store
            .drives
            .get(drive_id)
            .is_some_and(|session| session.phase == DriveSessionPhase::ReadingMetadata)
    })
}

pub fn is_playing(drive_id: &str) -> bool {
    with_sessions(|store| {
        store
            .drives
            .get(drive_id)
            .is_some_and(|session| session.phase == DriveSessionPhase::Playing)
    })
}

pub fn is_ripping(drive_id: &str) -> bool {
    with_sessions(|store| {
        store
            .drives
            .get(drive_id)
            .is_some_and(|session| session.phase == DriveSessionPhase::Ripping)
    })
}

/// User-initiated TOC / CD-Text reads must not contend with playback or ripping.
pub fn should_defer_user_disc_read(drive_id: &str) -> bool {
    is_playing(drive_id) || is_ripping(drive_id)
}

pub fn invalidate_presence_cache(drive_id: &str) {
    with_status_cache(drive_id, |cache| {
        cache.has_audio_cd = None;
        cache.volume_path = None;
        cache.updated_at = Instant::now() - STATUS_CACHE_TTL * 2;
    });
}

pub fn invalidate_all_presence_cache() {
    with_sessions(|store| {
        for session in store.drives.values_mut() {
            session.cache.has_audio_cd = None;
            session.cache.volume_path = None;
            session.cache.updated_at = Instant::now() - STATUS_CACHE_TTL * 2;
        }
    });
}

fn normalize_volume_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed.trim_end_matches('/').to_string()
}

pub fn clear_drive_on_unmount(normalized_volume_path: &str, bsd_name: Option<&str>) {
    if normalized_volume_path.is_empty() {
        return;
    }

    with_sessions(|store| {
        for (drive_id, session) in store.drives.iter_mut() {
            let matches_volume = session.cache.volume_path.as_ref().is_some_and(|cached_path| {
                normalize_volume_path(cached_path) == normalized_volume_path
            });
            let matches_bsd = bsd_name.is_some_and(|bsd| bsd == drive_id.as_str());
            if !matches_volume && !matches_bsd {
                continue;
            }
            session.cache.has_audio_cd = Some(false);
            session.cache.volume_path = None;
            session.cache.updated_at = Instant::now();
        }
    });
}

pub fn remove_drive(drive_id: &str) {
    with_sessions(|store| {
        store.drives.remove(drive_id);
    });
}

pub struct DriveSessionGuard {
    drive_id: String,
    phase: DriveSessionPhase,
}

impl Drop for DriveSessionGuard {
    fn drop(&mut self) {
        with_sessions(|store| {
            if let Some(session) = store.drives.get_mut(&self.drive_id) {
                if session.phase == self.phase {
                    session.phase = DriveSessionPhase::Idle;
                }
            }
        });
    }
}

pub fn begin_phase(drive_id: &str, phase: DriveSessionPhase) -> DriveSessionGuard {
    with_sessions(|store| {
        let session = store.entry_mut(drive_id);
        session.phase = phase;
    });
    DriveSessionGuard {
        drive_id: drive_id.to_string(),
        phase,
    }
}
