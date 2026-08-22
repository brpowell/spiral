use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::activity_log::{self, LogLevel};
use crate::license::{self, Cosmetic, LicenseSnapshot, LicenseStatus};

const DEFAULT_LICENSE_SERVER: &str = "http://127.0.0.1:8787";
const FINALIZE_PATH: &str = "/v1/license/finalize";
const FINALIZE_TIMEOUT: Duration = Duration::from_secs(30);
const USER_AGENT: &str = "Spiral/0.1.0 (https://github.com/brpowell/spiral)";

/// Event + command surface for OS file-association opens of `.spcard`.
pub const SPCARD_OPENED_EVENT: &str = "spiral:spcard-opened";

/// Pending `.spcard` paths delivered before the frontend is ready.
pub struct PendingSpcardOpens(pub Mutex<Vec<String>>);

impl Default for PendingSpcardOpens {
    fn default() -> Self {
        Self(Mutex::new(Vec::new()))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FinalizeRequestBody<'a> {
    original_purchase_id: &'a str,
}

#[tauri::command]
pub fn get_license_state(app: AppHandle) -> Result<LicenseSnapshot, String> {
    license::load_license_snapshot(&app)
}

/// Absolute path to the installed `registration.spcard` (for Reveal in Finder).
#[tauri::command]
pub fn get_registration_spcard_path(app: AppHandle) -> Result<String, String> {
    license::registration_spcard_path_if_present(&app)
}

#[tauri::command]
pub fn pick_spcard_file() -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .set_title("Install Spiral Card")
        .add_filter("Spiral Card", &["spcard", "SPCARD"])
        .pick_file();

    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn pick_card_wrap_file() -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .set_title("Choose Spiral Card wrap")
        .add_filter(
            "Images",
            &["jpg", "jpeg", "png", "webp", "JPG", "JPEG", "PNG", "WEBP"],
        )
        .pick_file();

    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn install_registration_card(app: AppHandle, path: String) -> Result<LicenseSnapshot, String> {
    license::install_registration_card(&app, &path)
}

/// Byte-copy the installed card to a user-chosen path (save dialog). Cancel → `Ok(None)`.
#[tauri::command]
pub fn export_registration_card(app: AppHandle) -> Result<Option<String>, String> {
    let source = license::registration_spcard_path_if_present(&app)?;
    let snapshot = license::load_license_snapshot(&app)?;
    let cardholder = snapshot
        .cosmetic
        .as_ref()
        .map(|c| c.cardholder_name.as_str())
        .unwrap_or("");
    let default_name = export_default_filename(cardholder);

    let dest = rfd::FileDialog::new()
        .set_title("Export Spiral Card")
        .set_file_name(&default_name)
        .add_filter("Spiral Card", &["spcard", "SPCARD"])
        .save_file();

    let dest = match dest {
        Some(p) => p,
        None => return Ok(None),
    };

    let dest = if dest
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("spcard"))
    {
        dest
    } else {
        dest.with_extension("spcard")
    };

    fs::copy(&source, &dest).map_err(|e| format!("failed to export Spiral Card: {e}"))?;
    Ok(Some(dest.to_string_lossy().into_owned()))
}

/// Filename-safe stem from cardholder name, else `spiral-card.spcard`.
fn export_default_filename(cardholder_name: &str) -> String {
    let trimmed = cardholder_name.trim();
    if trimmed.is_empty() {
        return "spiral-card.spcard".into();
    }
    let stem = crate::library_organize::sanitize_filename(trimmed);
    format!("{stem}.spcard")
}

/// Update local card cosmetics only (offline; never touches grants).
#[tauri::command]
pub fn update_registration_cosmetic(
    app: AppHandle,
    cosmetic: Cosmetic,
) -> Result<LicenseSnapshot, String> {
    license::update_registration_cosmetic(&app, cosmetic)
}

/// Custom wrap from a picked image path — re-encode / cap / EXIF-strip.
#[tauri::command]
pub fn set_registration_wrap_from_file(
    app: AppHandle,
    path: String,
) -> Result<LicenseSnapshot, String> {
    let bytes = fs::read(&path).map_err(|e| format!("failed to read wrap image: {e}"))?;
    license::set_registration_wrap_from_bytes(&app, &bytes)
}

#[tauri::command]
pub fn clear_registration_wrap(app: AppHandle) -> Result<LicenseSnapshot, String> {
    license::clear_registration_wrap(&app)
}

/// Drain `.spcard` paths queued before the UI was ready (cold start).
#[tauri::command]
pub fn take_pending_spcard_opens(
    pending: State<'_, PendingSpcardOpens>,
) -> Result<Vec<String>, String> {
    let mut guard = pending
        .0
        .lock()
        .map_err(|_| "pending spcard lock poisoned".to_string())?;
    Ok(std::mem::take(&mut *guard))
}

/// User-initiated finalize: POST only `originalPurchaseId`, merge grant.
#[tauri::command]
pub fn finalize_registration(app: AppHandle) -> Result<LicenseSnapshot, String> {
    let snapshot = license::load_license_snapshot(&app)?;
    match snapshot.status {
        LicenseStatus::ReadyToFinalize | LicenseStatus::Licensed => {}
        other => {
            return Err(format!(
                "registration is not ready to finalize (status: {})",
                status_label(other)
            ));
        }
    }

    let Some(purchase_id) = snapshot.original_purchase_id.as_deref() else {
        return Err("installed card has no purchase id".into());
    };

    let grant_json = match post_finalize(purchase_id) {
        Ok(body) => body,
        Err(e) => {
            activity_log::log(
                LogLevel::Error,
                "license.registration",
                format!("Registration finalize failed — {}", e.message),
                Some(serde_json::json!({
                    "code": e.code,
                    "originalPurchaseId": purchase_id,
                })),
            );
            return Err(format!("{}: {}", e.code, e.message));
        }
    };

    match license::merge_finalized_grant_json(&app, &grant_json) {
        Ok(merged) => {
            let timestamp = Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
            activity_log::log(
                LogLevel::Info,
                "license.registration",
                format!("Registration finalized — {timestamp}"),
                Some(serde_json::json!({
                    "originalPurchaseId": purchase_id,
                })),
            );
            Ok(merged)
        }
        Err(e) => {
            activity_log::log(
                LogLevel::Error,
                "license.registration",
                format!("Registration finalize merge failed — {e}"),
                Some(serde_json::json!({
                    "originalPurchaseId": purchase_id,
                })),
            );
            Err(e)
        }
    }
}

fn status_label(status: LicenseStatus) -> &'static str {
    match status {
        LicenseStatus::Trial => "trial",
        LicenseStatus::Provisional => "provisional",
        LicenseStatus::ReadyToFinalize => "readyToFinalize",
        LicenseStatus::Licensed => "licensed",
    }
}

struct FinalizeHttpError {
    code: &'static str,
    message: String,
}

fn license_server_base() -> String {
    env::var("SPIRAL_LICENSE_SERVER")
        .ok()
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_LICENSE_SERVER.to_string())
}

fn post_finalize(original_purchase_id: &str) -> Result<String, FinalizeHttpError> {
    let url = format!("{}{FINALIZE_PATH}", license_server_base());
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(FINALIZE_TIMEOUT)
        .build()
        .map_err(|e| FinalizeHttpError {
            code: "network_error",
            message: format!("failed to build HTTP client: {e}"),
        })?;

    let response = client
        .post(&url)
        .json(&FinalizeRequestBody {
            original_purchase_id,
        })
        .send()
        .map_err(|e| FinalizeHttpError {
            code: "network_error",
            message: format!("could not reach license server: {e}"),
        })?;

    let status = response.status();
    let body = response.text().map_err(|e| FinalizeHttpError {
        code: "network_error",
        message: format!("failed to read finalize response: {e}"),
    })?;

    if status.is_success() {
        return Ok(body);
    }

    let (code, message) = parse_error_body(&body, status.as_u16());
    Err(FinalizeHttpError { code, message })
}

fn parse_error_body(body: &str, status: u16) -> (&'static str, String) {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(code) = value.get("code").and_then(|c| c.as_str()) {
            let message = value
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or(code)
                .to_string();
            let mapped = match code {
                "unknown_purchase" => "unknown_purchase",
                "refunded" => "refunded",
                "invalid_purchase_id" | "invalid_json" => "invalid_request",
                "network_error" => "network_error",
                other if !other.is_empty() => {
                    return ("finalize_failed", format!("{other}: {message}"));
                }
                _ => "finalize_failed",
            };
            return (mapped, message);
        }
    }

    let code = match status {
        404 => "unknown_purchase",
        403 => "refunded",
        400 => "invalid_request",
        _ => "network_error",
    };
    let message = if body.trim().is_empty() {
        format!("license server returned HTTP {status}")
    } else {
        body.chars().take(200).collect()
    };
    (code, message)
}

/// Queue / emit `.spcard` paths opened via OS file association.
pub fn handle_opened_spcard_paths(app: &AppHandle, paths: Vec<PathBuf>) {
    let spcards: Vec<String> = paths
        .into_iter()
        .filter(|p| is_spcard_path(p))
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect();

    if spcards.is_empty() {
        return;
    }

    if let Some(pending) = app.try_state::<PendingSpcardOpens>() {
        if let Ok(mut guard) = pending.0.lock() {
            guard.extend(spcards.iter().cloned());
        }
    }

    let _ = app.emit(SPCARD_OPENED_EVENT, &spcards);
}

/// Parse argv paths that look like local `.spcard` files (Windows / Linux cold start).
#[cfg(any(windows, target_os = "linux"))]
pub fn spcard_paths_from_args(args: impl IntoIterator<Item = String>) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for maybe_file in args {
        if maybe_file.starts_with('-') {
            continue;
        }
        // Handle `file://` path urls and plain paths.
        let path = if let Some(rest) = maybe_file.strip_prefix("file://") {
            PathBuf::from(rest)
        } else {
            PathBuf::from(&maybe_file)
        };
        if is_spcard_path(&path) {
            files.push(path);
        }
    }
    files
}

fn is_spcard_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("spcard"))
}
