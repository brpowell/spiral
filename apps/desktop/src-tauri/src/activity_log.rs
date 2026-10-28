//! Structured in-memory activity log with Tauri event streaming.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub const ACTIVITY_LOG_EVENT: &str = "activity://entry";

const MAX_ENTRIES: usize = 500;

static APP_HANDLE: LazyLock<Mutex<Option<AppHandle>>> = LazyLock::new(|| Mutex::new(None));
static BUFFER: LazyLock<Mutex<VecDeque<ActivityLogEntry>>> =
    LazyLock::new(|| Mutex::new(VecDeque::new()));
static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

thread_local! {
    static THREAD_CONTEXT: std::cell::RefCell<ActivityLogContext> =
        std::cell::RefCell::new(ActivityLogContext {
            drive_id: None,
            disc_id: None,
            release_mbid: None,
            artist: None,
            album: None,
        });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drive_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disc_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_mbid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogEntry {
    pub id: String,
    pub timestamp_ms: u64,
    pub level: LogLevel,
    pub domain: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<ActivityLogContext>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogDraft {
    pub level: LogLevel,
    pub domain: String,
    pub message: String,
    #[serde(default)]
    pub context: Option<ActivityLogContext>,
    #[serde(default)]
    pub details: Option<serde_json::Value>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn new_id() -> String {
    format!(
        "{:x}-{}",
        now_ms(),
        ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

pub fn init(app: AppHandle) {
    if let Ok(mut guard) = APP_HANDLE.lock() {
        *guard = Some(app);
    }
}

pub fn set_thread_context(ctx: ActivityLogContext) {
    THREAD_CONTEXT.with(|cell| {
        *cell.borrow_mut() = ctx;
    });
}

pub fn clear_thread_context() {
    THREAD_CONTEXT.with(|cell| {
        *cell.borrow_mut() = ActivityLogContext::default();
    });
}

pub fn thread_has_drive_id() -> bool {
    current_thread_context().drive_id.is_some()
}

pub fn thread_artist() -> Option<String> {
    current_thread_context().artist
}

fn current_thread_context() -> ActivityLogContext {
    THREAD_CONTEXT.with(|cell| cell.borrow().clone())
}

fn merge_context(explicit: Option<ActivityLogContext>) -> Option<ActivityLogContext> {
    let thread_ctx = current_thread_context();
    let mut merged = explicit.unwrap_or_default();

    if merged.drive_id.is_none() {
        merged.drive_id = thread_ctx.drive_id;
    }
    if merged.disc_id.is_none() {
        merged.disc_id = thread_ctx.disc_id;
    }
    if merged.release_mbid.is_none() {
        merged.release_mbid = thread_ctx.release_mbid;
    }
    if merged.artist.is_none() {
        merged.artist = thread_ctx.artist;
    }
    if merged.album.is_none() {
        merged.album = thread_ctx.album;
    }

    if merged.drive_id.is_none()
        && merged.disc_id.is_none()
        && merged.release_mbid.is_none()
        && merged.artist.is_none()
        && merged.album.is_none()
    {
        None
    } else {
        Some(merged)
    }
}

pub fn append_draft(draft: ActivityLogDraft) -> ActivityLogEntry {
    let context = merge_context(draft.context);

    let entry = ActivityLogEntry {
        id: new_id(),
        timestamp_ms: now_ms(),
        level: draft.level,
        domain: draft.domain,
        message: draft.message,
        context,
        details: draft.details,
    };

    if let Ok(mut buffer) = BUFFER.lock() {
        buffer.push_back(entry.clone());
        while buffer.len() > MAX_ENTRIES {
            buffer.pop_front();
        }
    }

    if let Ok(guard) = APP_HANDLE.lock() {
        if let Some(app) = guard.as_ref() {
            let _ = app.emit(ACTIVITY_LOG_EVENT, &entry);
        }
    }

    entry
}

pub fn log(
    level: LogLevel,
    domain: &str,
    message: impl Into<String>,
    details: Option<serde_json::Value>,
) {
    append_draft(ActivityLogDraft {
        level,
        domain: domain.to_string(),
        message: message.into(),
        context: None,
        details,
    });
}

pub fn get_recent(limit: usize, domain_prefix: Option<&str>) -> Vec<ActivityLogEntry> {
    let Ok(buffer) = BUFFER.lock() else {
        return Vec::new();
    };

    buffer
        .iter()
        .rev()
        .filter(|entry| domain_prefix.is_none_or(|prefix| entry.domain.starts_with(prefix)))
        .take(limit)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

pub fn clear() {
    if let Ok(mut buffer) = BUFFER.lock() {
        buffer.clear();
    }
}
