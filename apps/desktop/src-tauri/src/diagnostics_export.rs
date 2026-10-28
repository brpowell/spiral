//! User-initiated diagnostics bundle for support / bug reports.

use serde::Serialize;
use tauri::AppHandle;

use crate::activity_log::{self, ActivityLogEntry};
use crate::crash_report::{self, CrashReport};

const ACTIVITY_LOG_LIMIT: usize = 500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsEnvironment {
    pub app_version: String,
    pub os: String,
    pub arch: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsCrashReport {
    pub id: String,
    #[serde(flatten)]
    pub report: CrashReport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsBundle {
    pub exported_at_ms: u64,
    pub environment: DiagnosticsEnvironment,
    /// Current-session activity log. Omitted when a crash report is included — breadcrumbs live in `crashReport.recentEntries`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity_log_entries: Option<Vec<ActivityLogEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crash_report: Option<DiagnosticsCrashReport>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn environment_info() -> DiagnosticsEnvironment {
    DiagnosticsEnvironment {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

fn resolve_crash_report(
    app: &AppHandle,
    crash_report_id: Option<&str>,
) -> Result<Option<DiagnosticsCrashReport>, String> {
    if let Some(id) = crash_report_id {
        let report = crash_report::read_report(app, id)?;
        return Ok(Some(DiagnosticsCrashReport {
            id: id.to_string(),
            report,
        }));
    }

    let summaries = crash_report::list_reports(app, false, None, false)?;
    let Some(summary) = summaries.into_iter().next() else {
        return Ok(None);
    };

    let report = crash_report::read_report(app, &summary.id)?;
    Ok(Some(DiagnosticsCrashReport {
        id: summary.id,
        report,
    }))
}

pub fn assemble(
    app: &AppHandle,
    crash_report_id: Option<&str>,
) -> Result<DiagnosticsBundle, String> {
    let crash_report = resolve_crash_report(app, crash_report_id)?;
    let activity_log_entries = if crash_report.is_some() {
        None
    } else {
        Some(activity_log::get_recent(ACTIVITY_LOG_LIMIT, None))
    };

    Ok(DiagnosticsBundle {
        exported_at_ms: now_ms(),
        environment: environment_info(),
        activity_log_entries,
        crash_report,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity_log::LogLevel;
    use crate::crash_report::CrashSource;

    #[test]
    fn diagnostics_bundle_serializes_expected_shape() {
        let bundle = DiagnosticsBundle {
            exported_at_ms: 1_700_000_000_000,
            environment: DiagnosticsEnvironment {
                app_version: "0.1.0".to_string(),
                os: "macos".to_string(),
                arch: "aarch64".to_string(),
            },
            activity_log_entries: None,
            crash_report: Some(DiagnosticsCrashReport {
                id: "1700000000000-1".to_string(),
                report: CrashReport {
                    timestamp_ms: 1_699_999_999_000,
                    source: CrashSource::Renderer,
                    message: "test crash".to_string(),
                    stack_or_backtrace: "Error: test".to_string(),
                    app_version: "0.1.0".to_string(),
                    recent_entries: vec![],
                },
            }),
        };

        let json = serde_json::to_value(&bundle).unwrap();
        assert_eq!(json["exportedAtMs"], 1_700_000_000_000_i64);
        assert_eq!(json["environment"]["appVersion"], "0.1.0");
        assert!(json.get("activityLogEntries").is_none());
        assert_eq!(json["crashReport"]["id"], "1700000000000-1");
        assert_eq!(json["crashReport"]["message"], "test crash");
    }

    #[test]
    fn diagnostics_bundle_includes_activity_log_without_crash_report() {
        let bundle = DiagnosticsBundle {
            exported_at_ms: 1,
            environment: DiagnosticsEnvironment {
                app_version: "0.1.0".to_string(),
                os: "macos".to_string(),
                arch: "aarch64".to_string(),
            },
            activity_log_entries: Some(vec![ActivityLogEntry {
                id: "entry-1".to_string(),
                timestamp_ms: 1,
                level: LogLevel::Info,
                domain: "library.refresh".to_string(),
                message: "refresh complete".to_string(),
                context: None,
                details: None,
            }]),
            crash_report: None,
        };

        let json = serde_json::to_value(&bundle).unwrap();
        assert_eq!(json["activityLogEntries"][0]["domain"], "library.refresh");
        assert!(json.get("crashReport").is_none());
    }
}
