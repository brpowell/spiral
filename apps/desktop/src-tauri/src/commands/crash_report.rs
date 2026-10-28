use tauri::AppHandle;

#[cfg(debug_assertions)]
use crate::activity_log::{self, LogLevel};
use crate::crash_report::{self, CrashReport, CrashReportSummary, CrashSource};

#[tauri::command]
pub fn list_crash_reports(
    app: AppHandle,
    prior_session_only: Option<bool>,
    source: Option<String>,
    exclude_acknowledged: Option<bool>,
) -> Result<Vec<CrashReportSummary>, String> {
    let source_filter = match source.as_deref() {
        None | Some("") => None,
        Some("rust") => Some(CrashSource::Rust),
        Some("renderer") => Some(CrashSource::Renderer),
        Some(other) => return Err(format!("unknown crash source filter: {other}")),
    };

    crash_report::list_reports(
        &app,
        prior_session_only.unwrap_or(false),
        source_filter,
        exclude_acknowledged.unwrap_or(false),
    )
}

#[tauri::command]
pub fn acknowledge_crash_report(app: AppHandle, id: String) -> Result<(), String> {
    crash_report::acknowledge_report(&app, &id)
}

#[tauri::command]
pub fn read_crash_report(app: AppHandle, id: String) -> Result<CrashReport, String> {
    crash_report::read_report(&app, &id)
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn trigger_test_panic() {
    activity_log::log(LogLevel::Info, "app", "About to trigger test panic", None);
    panic!("Spiral test panic — crash capture verification");
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn get_crash_reports_dir(app: AppHandle) -> Result<String, String> {
    crash_report::crash_reports_dir(&app).map(|path| path.to_string_lossy().into_owned())
}
