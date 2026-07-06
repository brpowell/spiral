use std::fs;

use tauri::AppHandle;

use crate::diagnostics_export::{self, DiagnosticsBundle};

#[tauri::command]
pub fn export_diagnostics(
    app: AppHandle,
    crash_report_id: Option<String>,
) -> Result<DiagnosticsBundle, String> {
    diagnostics_export::assemble(&app, crash_report_id.as_deref())
}

#[tauri::command]
pub fn save_diagnostics_export(
    app: AppHandle,
    crash_report_id: Option<String>,
) -> Result<Option<String>, String> {
    let bundle = diagnostics_export::assemble(&app, crash_report_id.as_deref())?;
    let json = serde_json::to_string_pretty(&bundle)
        .map_err(|e| format!("failed to serialize diagnostics export: {e}"))?;

    let default_name = format!("spiral-diagnostics-{}.json", bundle.exported_at_ms);
    let path = rfd::FileDialog::new()
        .set_title("Export logs")
        .set_file_name(&default_name)
        .add_filter("JSON", &["json"])
        .save_file();

    match path {
        Some(path) => {
            fs::write(&path, json)
                .map_err(|e| format!("failed to write diagnostics export: {e}"))?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}
