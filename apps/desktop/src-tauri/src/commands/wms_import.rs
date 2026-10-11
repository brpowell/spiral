use serde::Serialize;
use std::path::PathBuf;

use crate::wms_import::{self, ImportWmsOptions, ImportWmsResult};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportWmsResultDto {
    pub skin_path: Option<String>,
    pub report_path: Option<String>,
    pub report_markdown: String,
    pub layout_ok: bool,
    pub errors: Vec<String>,
}

impl From<ImportWmsResult> for ImportWmsResultDto {
    fn from(value: ImportWmsResult) -> Self {
        Self {
            skin_path: value.skin_path.map(|p| p.to_string_lossy().into_owned()),
            report_path: value.report_path.map(|p| p.to_string_lossy().into_owned()),
            report_markdown: value.report_markdown,
            layout_ok: value.layout_ok,
            errors: value.errors,
        }
    }
}

#[tauri::command]
pub fn import_wms_skin(
    input: String,
    out: String,
    id: Option<String>,
    chroma: Option<String>,
    dry_run: Option<bool>,
) -> Result<ImportWmsResultDto, String> {
    let result = wms_import::import_wms_skin(&ImportWmsOptions {
        input: PathBuf::from(input),
        out: PathBuf::from(out),
        id,
        chroma,
        dry_run: dry_run.unwrap_or(false),
    })?;
    Ok(ImportWmsResultDto::from(result))
}
