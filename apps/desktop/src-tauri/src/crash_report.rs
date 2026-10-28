//! Crash report capture — writes JSON artifacts on Rust panic.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::activity_log::ActivityLogEntry;
use crate::settings;

const MAX_CRASH_REPORTS: usize = 20;
const RECENT_ENTRIES_LIMIT: usize = 100;

static APP_HANDLE: LazyLock<Mutex<Option<AppHandle>>> = LazyLock::new(|| Mutex::new(None));
static REPORT_COUNTER: AtomicU64 = AtomicU64::new(0);
static SESSION_START_MS: AtomicU64 = AtomicU64::new(0);

const MESSAGE_PREVIEW_LEN: usize = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CrashSource {
    Rust,
    Renderer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReportSummary {
    pub id: String,
    pub timestamp_ms: u64,
    pub source: CrashSource,
    pub message_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    pub timestamp_ms: u64,
    pub source: CrashSource,
    pub message: String,
    pub stack_or_backtrace: String,
    pub app_version: String,
    pub recent_entries: Vec<ActivityLogEntry>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn report_filename(timestamp_ms: u64) -> String {
    format!(
        "{}-{:x}.json",
        timestamp_ms,
        REPORT_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

pub fn crash_reports_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = settings::app_data_dir(app)?.join("crash-reports");
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create crash-reports dir: {e}"))?;
    Ok(dir)
}

pub fn write_report(
    reports_dir: &Path,
    source: CrashSource,
    message: String,
    stack_or_backtrace: String,
    recent_entries: Vec<ActivityLogEntry>,
) -> Result<PathBuf, String> {
    let timestamp_ms = now_ms();
    let report = CrashReport {
        timestamp_ms,
        source,
        message,
        stack_or_backtrace,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        recent_entries,
    };

    let path = reports_dir.join(report_filename(timestamp_ms));
    let json = serde_json::to_string_pretty(&report)
        .map_err(|e| format!("failed to serialize crash report: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("failed to write crash report: {e}"))?;

    prune_old_reports(reports_dir)?;

    Ok(path)
}

pub fn write_from_app(
    app: &AppHandle,
    source: CrashSource,
    message: String,
    stack_or_backtrace: String,
) -> Result<PathBuf, String> {
    if source == CrashSource::Renderer {
        return Err("renderer crashes are not written to disk".to_string());
    }

    let recent_entries = crate::activity_log::get_recent(RECENT_ENTRIES_LIMIT, None);
    let dir = crash_reports_dir(app)?;
    write_report(&dir, source, message, stack_or_backtrace, recent_entries)
}

pub fn acknowledge_report(app: &AppHandle, id: &str) -> Result<(), String> {
    if !is_valid_report_id(id) {
        return Err(format!("invalid crash report id: {id}"));
    }
    settings::push_acknowledged_crash_report_id(app, id)
}

fn prune_old_reports(dir: &Path) -> Result<(), String> {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .map_err(|e| format!("failed to read crash-reports dir: {e}"))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
        .collect();

    if entries.len() <= MAX_CRASH_REPORTS {
        return Ok(());
    }

    entries.sort_by_key(|entry| {
        entry
            .metadata()
            .and_then(|meta| meta.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH)
    });

    let to_remove = entries.len() - MAX_CRASH_REPORTS;
    for entry in entries.into_iter().take(to_remove) {
        let _ = fs::remove_file(entry.path());
    }

    Ok(())
}

fn write_panic_report(info: &std::panic::PanicHookInfo<'_>) {
    let message = info
        .payload()
        .downcast_ref::<&str>()
        .map(|value| (*value).to_string())
        .or_else(|| info.payload().downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".to_string());

    let location = info
        .location()
        .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
        .unwrap_or_default();

    let stack_or_backtrace = std::backtrace::Backtrace::force_capture().to_string();
    let full_stack = if location.is_empty() {
        stack_or_backtrace
    } else {
        format!("{location}\n{stack_or_backtrace}")
    };

    let app = APP_HANDLE.lock().ok().and_then(|guard| guard.clone());
    if let Some(app) = app {
        if let Err(err) = write_from_app(&app, CrashSource::Rust, message, full_stack) {
            eprintln!("failed to write crash report: {err}");
        }
    }
}

fn install_panic_hook() {
    static INSTALLED: std::sync::Once = std::sync::Once::new();
    INSTALLED.call_once(|| {
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            write_panic_report(info);
            default_hook(info);
        }));
    });
}

fn message_preview(message: &str) -> String {
    let trimmed = message.trim();
    if trimmed.chars().count() <= MESSAGE_PREVIEW_LEN {
        return trimmed.to_string();
    }
    let end = trimmed
        .char_indices()
        .nth(MESSAGE_PREVIEW_LEN)
        .map(|(index, _)| index)
        .unwrap_or(trimmed.len());
    format!("{}…", &trimmed[..end])
}

fn report_id_from_path(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::to_string)
}

fn is_valid_report_id(id: &str) -> bool {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return false;
    }

    let Some((timestamp, suffix)) = id.split_once('-') else {
        return false;
    };

    !timestamp.is_empty()
        && timestamp.chars().all(|c| c.is_ascii_digit())
        && !suffix.is_empty()
        && suffix.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn list_reports(
    app: &AppHandle,
    prior_session_only: bool,
    source: Option<CrashSource>,
    exclude_acknowledged: bool,
) -> Result<Vec<CrashReportSummary>, String> {
    let dir = crash_reports_dir(app)?;
    let session_start_ms = SESSION_START_MS.load(Ordering::Relaxed);

    let mut summaries = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("failed to read crash-reports dir: {e}"))? {
        let entry = entry.map_err(|e| format!("failed to read crash report entry: {e}"))?;
        let path = entry.path();
        if path.extension().is_none_or(|ext| ext != "json") {
            continue;
        }

        let Some(id) = report_id_from_path(&path) else {
            continue;
        };

        if !is_valid_report_id(&id) {
            continue;
        }

        let contents = match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(err) => {
                eprintln!("failed to read crash report {id}: {err}");
                continue;
            }
        };

        let report: CrashReport = match serde_json::from_str(&contents) {
            Ok(report) => report,
            Err(err) => {
                eprintln!("failed to parse crash report {id}: {err}");
                continue;
            }
        };

        if !matches_list_filters(&report, prior_session_only, session_start_ms, source) {
            continue;
        }

        if exclude_acknowledged && settings::is_crash_report_acknowledged(app, &id) {
            continue;
        }

        summaries.push(CrashReportSummary {
            id,
            timestamp_ms: report.timestamp_ms,
            source: report.source,
            message_preview: message_preview(&report.message),
        });
    }

    summaries.sort_by(|left, right| right.timestamp_ms.cmp(&left.timestamp_ms));
    Ok(summaries)
}

fn matches_list_filters(
    report: &CrashReport,
    prior_session_only: bool,
    session_start_ms: u64,
    source: Option<CrashSource>,
) -> bool {
    if prior_session_only && report.timestamp_ms >= session_start_ms {
        return false;
    }
    if let Some(filter) = source {
        if report.source != filter {
            return false;
        }
    }
    true
}

pub fn read_report(app: &AppHandle, id: &str) -> Result<CrashReport, String> {
    if !is_valid_report_id(id) {
        return Err(format!("invalid crash report id: {id}"));
    }

    let path = crash_reports_dir(app)?.join(format!("{id}.json"));
    let contents =
        fs::read_to_string(&path).map_err(|e| format!("failed to read crash report {id}: {e}"))?;
    let mut report: CrashReport = serde_json::from_str(&contents)
        .map_err(|e| format!("failed to parse crash report {id}: {e}"))?;
    // Stored oldest-first; present newest-first (stack-trace style).
    report.recent_entries.reverse();
    Ok(report)
}

pub fn init(app: AppHandle) {
    SESSION_START_MS.store(now_ms(), Ordering::Relaxed);
    if let Ok(mut guard) = APP_HANDLE.lock() {
        *guard = Some(app);
    }
    install_panic_hook();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity_log::LogLevel;

    fn sample_entry(id: &str, domain: &str) -> ActivityLogEntry {
        ActivityLogEntry {
            id: id.to_string(),
            timestamp_ms: 1,
            level: LogLevel::Info,
            domain: domain.to_string(),
            message: format!("message for {id}"),
            context: None,
            details: None,
        }
    }

    #[test]
    fn crash_report_serializes_expected_shape() {
        let report = CrashReport {
            timestamp_ms: 1_700_000_000_000,
            source: CrashSource::Renderer,
            message: "test error".to_string(),
            stack_or_backtrace: "Error: test\n    at foo".to_string(),
            app_version: "0.1.0".to_string(),
            recent_entries: vec![sample_entry("abc", "app")],
        };

        let json = serde_json::to_value(&report).unwrap();
        assert_eq!(json["timestampMs"], 1_700_000_000_000_i64);
        assert_eq!(json["source"], "renderer");
        assert_eq!(json["message"], "test error");
        assert_eq!(json["stackOrBacktrace"], "Error: test\n    at foo");
        assert_eq!(json["appVersion"], "0.1.0");
        assert_eq!(json["recentEntries"][0]["domain"], "app");
    }

    #[test]
    fn retention_prunes_oldest_reports() {
        let dir =
            std::env::temp_dir().join(format!("spiral-crash-retention-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let first_path = write_report(
            &dir,
            CrashSource::Rust,
            "panic 0".to_string(),
            "backtrace".to_string(),
            vec![sample_entry("entry-0", "library")],
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));

        for index in 1..22 {
            write_report(
                &dir,
                CrashSource::Rust,
                format!("panic {index}"),
                "backtrace".to_string(),
                vec![sample_entry(&format!("entry-{index}"), "library")],
            )
            .unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2));
        }

        let remaining: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .collect();

        assert_eq!(remaining.len(), MAX_CRASH_REPORTS);
        assert!(!first_path.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_report_round_trips_json() {
        let dir =
            std::env::temp_dir().join(format!("spiral-crash-roundtrip-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let path = write_report(
            &dir,
            CrashSource::Rust,
            "boom".to_string(),
            "trace".to_string(),
            vec![sample_entry("x", "metadata")],
        )
        .unwrap();

        let contents = fs::read_to_string(path).unwrap();
        let parsed: CrashReport = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed.source, CrashSource::Rust);
        assert_eq!(parsed.message, "boom");
        assert_eq!(parsed.recent_entries.len(), 1);
        assert_eq!(parsed.recent_entries[0].domain, "metadata");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn message_preview_truncates_long_messages() {
        let preview = message_preview(&"x".repeat(200));
        assert!(preview.ends_with('…'));
        assert!(preview.chars().count() <= MESSAGE_PREVIEW_LEN + 1);
    }

    #[test]
    fn matches_list_filters_by_source_and_session() {
        let rust_report = CrashReport {
            timestamp_ms: 100,
            source: CrashSource::Rust,
            message: "panic".to_string(),
            stack_or_backtrace: String::new(),
            app_version: "0.1.0".to_string(),
            recent_entries: vec![],
        };
        let renderer_report = CrashReport {
            timestamp_ms: 100,
            source: CrashSource::Renderer,
            message: "rejection".to_string(),
            stack_or_backtrace: String::new(),
            app_version: "0.1.0".to_string(),
            recent_entries: vec![],
        };

        assert!(matches_list_filters(
            &rust_report,
            false,
            50,
            Some(CrashSource::Rust),
        ));
        assert!(!matches_list_filters(
            &renderer_report,
            false,
            50,
            Some(CrashSource::Rust),
        ));
        assert!(matches_list_filters(
            &renderer_report,
            false,
            50,
            Some(CrashSource::Renderer),
        ));
        assert!(matches_list_filters(&rust_report, false, 50, None));

        let current_session_report = CrashReport {
            timestamp_ms: 200,
            ..rust_report.clone()
        };
        assert!(!matches_list_filters(
            &current_session_report,
            true,
            150,
            Some(CrashSource::Rust),
        ));
        assert!(matches_list_filters(
            &current_session_report,
            false,
            150,
            Some(CrashSource::Rust),
        ));
    }

    #[test]
    fn list_and_read_reports_by_id() {
        let dir =
            std::env::temp_dir().join(format!("spiral-crash-list-read-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let path = write_report(
            &dir,
            CrashSource::Renderer,
            "renderer failure".to_string(),
            "stack trace".to_string(),
            vec![sample_entry("entry-1", "app")],
        )
        .unwrap();
        let id = report_id_from_path(&path).unwrap();

        let contents = fs::read_to_string(&path).unwrap();
        let report: CrashReport = serde_json::from_str(&contents).unwrap();

        assert_eq!(report_id_from_path(&path), Some(id.clone()));
        assert_eq!(report.message, "renderer failure");
        assert!(!is_valid_report_id("../escape"));
        assert!(!is_valid_report_id("acknowledged"));
        assert!(is_valid_report_id(&id));

        let _ = fs::remove_dir_all(&dir);
    }
}
