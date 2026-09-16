use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::activity_log::{self, LogLevel};
use crate::license::handoff::{
    card_grant_fetch_url, card_handoff_fetch_url, card_origin_from_env, parse_handoff_url,
    ParsedHandoff,
};
use crate::license::{self, LicenseDemoted, LicensePromptState, LicenseSnapshot, LicenseStatus};

const GRANT_PULL_TIMEOUT: Duration = Duration::from_secs(30);
const HANDOFF_TIMEOUT: Duration = Duration::from_secs(30);

/// Event + command surface for OS file-association opens of `.spcard`.
pub const SPCARD_OPENED_EVENT: &str = "spiral:spcard-opened";
/// Event + command surface for `spiral://card/install` tokens.
pub const SPCARD_HANDOFF_EVENT: &str = "spiral:spcard-handoff";

/// Pending `.spcard` paths delivered before the frontend is ready.
pub struct PendingSpcardOpens(pub Mutex<Vec<String>>);

impl Default for PendingSpcardOpens {
    fn default() -> Self {
        Self(Mutex::new(Vec::new()))
    }
}

/// Pending handoff requests delivered before the frontend is ready.
pub struct PendingSpcardHandoffs {
    queued: Mutex<Vec<ParsedHandoff>>,
    seen: Mutex<HashSet<String>>,
}

impl Default for PendingSpcardHandoffs {
    fn default() -> Self {
        Self {
            queued: Mutex::new(Vec::new()),
            seen: Mutex::new(HashSet::new()),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GrantRequestBody<'a> {
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
pub fn install_registration_card(app: AppHandle, path: String) -> Result<LicenseSnapshot, String> {
    license::install_registration_card(&app, &path)
}

#[tauri::command]
pub fn install_registration_card_json(
    app: AppHandle,
    json: String,
) -> Result<LicenseSnapshot, String> {
    license::install_registration_card_json(&app, &json)
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

/// Drain handoff requests queued before the UI was ready (cold start).
#[tauri::command]
pub fn take_pending_spcard_handoffs(
    pending: State<'_, PendingSpcardHandoffs>,
) -> Result<Vec<ParsedHandoff>, String> {
    let mut guard = pending
        .queued
        .lock()
        .map_err(|_| "pending spcard handoff lock poisoned".to_string())?;
    Ok(std::mem::take(&mut *guard))
}

/// Fetch a signed `.spcard` from the allowlisted handoff endpoint.
#[tauri::command]
pub async fn redeem_card_handoff(token: String, origin: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_card_handoff(&token, &origin))
        .await
        .map_err(|e| e.to_string())?
}

/// User-initiated pull of the current grant: POST only `originalPurchaseId`, merge.
///
/// A mapped `refunded` response strips the card and returns Ok(trial + demoted).
#[tauri::command]
pub async fn pull_current_grant(app: AppHandle) -> Result<LicenseSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || pull_current_grant_blocking(app))
        .await
        .map_err(|e| e.to_string())?
}

fn pull_current_grant_blocking(app: AppHandle) -> Result<LicenseSnapshot, String> {
    let snapshot = license::load_license_snapshot(&app)?;
    match snapshot.status {
        LicenseStatus::ReadyToUpdate | LicenseStatus::Licensed => {}
        other => {
            return Err(format!(
                "registration is not ready to refresh (status: {})",
                status_label(other)
            ));
        }
    }

    let Some(purchase_id) = snapshot.original_purchase_id.as_deref() else {
        return Err("installed card has no purchase id".into());
    };

    let grant_json = match post_current_grant(purchase_id) {
        Ok(body) => body,
        Err(e) => {
            if e.code == "refunded" {
                let stripped = license::remove_registration_card(&app, LicenseDemoted::Refunded)?;
                activity_log::log(
                    LogLevel::Info,
                    "license.registration",
                    "Registration stripped — purchase refunded",
                    Some(serde_json::json!({
                        "demoted": "refunded",
                        "originalPurchaseId": purchase_id,
                    })),
                );
                return Ok(stripped);
            }
            activity_log::log(
                LogLevel::Error,
                "license.registration",
                format!("Card grant refresh failed — {}", e.message),
                Some(serde_json::json!({
                    "code": e.code,
                    "originalPurchaseId": purchase_id,
                })),
            );
            return Err(format!("{}: {}", e.code, e.message));
        }
    };

    match license::merge_current_grant_json(&app, &grant_json) {
        Ok(merged) => {
            let timestamp = Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
            activity_log::log(
                LogLevel::Info,
                "license.registration",
                format!("Card grant refreshed — {timestamp}"),
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
                format!("Card grant merge failed — {e}"),
                Some(serde_json::json!({
                    "originalPurchaseId": purchase_id,
                })),
            );
            Err(e)
        }
    }
}

#[tauri::command]
pub fn get_license_prompt_state(app: AppHandle) -> Result<LicensePromptState, String> {
    Ok(license::read_license_prompt_state(&app))
}

#[tauri::command]
pub fn set_license_prompt_state(app: AppHandle, state: LicensePromptState) -> Result<(), String> {
    license::write_license_prompt_state(&app, &state)
}

fn status_label(status: LicenseStatus) -> &'static str {
    match status {
        LicenseStatus::Trial => "trial",
        LicenseStatus::Provisional => "provisional",
        LicenseStatus::ReadyToUpdate => "readyToUpdate",
        LicenseStatus::Licensed => "licensed",
    }
}

struct GrantHttpError {
    code: &'static str,
    message: String,
}

fn post_current_grant(original_purchase_id: &str) -> Result<String, GrantHttpError> {
    let origin = card_handoff_origin();
    let url = card_grant_fetch_url(&origin).map_err(|e| GrantHttpError {
        code: "network_error",
        message: format!("invalid card origin: {e}"),
    })?;
    let client = reqwest::blocking::Client::builder()
        .user_agent(crate::USER_AGENT)
        .timeout(GRANT_PULL_TIMEOUT)
        .build()
        .map_err(|e| GrantHttpError {
            code: "network_error",
            message: format!("failed to build HTTP client: {e}"),
        })?;

    let response = client
        .post(&url)
        .json(&GrantRequestBody {
            original_purchase_id,
        })
        .send()
        .map_err(|e| GrantHttpError {
            code: "network_error",
            message: format!("could not reach card origin: {e}"),
        })?;

    let status = response.status();
    let body = response.text().map_err(|e| GrantHttpError {
        code: "network_error",
        message: format!("failed to read grant response: {e}"),
    })?;

    if status.is_success() {
        return Ok(body);
    }

    let (code, message) = parse_error_body(&body, status.as_u16());
    Err(GrantHttpError { code, message })
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
                "rate_limited" => "rate_limited",
                other if !other.is_empty() => {
                    return ("grant_failed", format!("{other}: {message}"));
                }
                _ => "grant_failed",
            };
            return (mapped, message);
        }
    }

    let code = match status {
        404 => "unknown_purchase",
        403 => "refunded",
        400 => "invalid_request",
        429 => "rate_limited",
        _ => "network_error",
    };
    let message = if body.trim().is_empty() {
        format!("card origin returned HTTP {status}")
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

/// Queue / emit tokens from `spiral://card/install` deep links.
pub fn handle_opened_handoff_urls(app: &AppHandle, urls: impl IntoIterator<Item = String>) {
    let default_origin = card_handoff_origin();
    let parsed: Vec<ParsedHandoff> = urls
        .into_iter()
        .filter_map(|url| parse_handoff_url(&url, &default_origin))
        .collect();

    if parsed.is_empty() {
        return;
    }

    let mut fresh = Vec::new();
    if let Some(pending) = app.try_state::<PendingSpcardHandoffs>() {
        let Ok(mut seen) = pending.seen.lock() else {
            return;
        };
        let Ok(mut queued) = pending.queued.lock() else {
            return;
        };
        for item in parsed {
            if seen.insert(item.token.clone()) {
                queued.push(item.clone());
                fresh.push(item);
            }
        }
    } else {
        fresh = parsed;
    }

    if fresh.is_empty() {
        return;
    }

    let _ = app.emit(SPCARD_HANDOFF_EVENT, &fresh);
}

fn card_handoff_origin() -> String {
    card_origin_from_env(
        env::var("SPIRAL_CARD_ORIGIN").ok().as_deref(),
        cfg!(debug_assertions),
    )
}

fn fetch_card_handoff(token: &str, origin: &str) -> Result<String, String> {
    let origin = if crate::license::handoff::is_allowed_card_origin(origin) {
        origin.trim().trim_end_matches('/').to_string()
    } else {
        card_handoff_origin()
    };
    let url = card_handoff_fetch_url(&origin, token)?;
    let client = reqwest::blocking::Client::builder()
        .user_agent(crate::USER_AGENT)
        .timeout(HANDOFF_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| {
            log_handoff_error(
                "network",
                &origin,
                &format!("failed to build HTTP client: {e}"),
            );
            "license.handoff.network".to_string()
        })?;

    let response = client.get(&url).send().map_err(|e| {
        log_handoff_error(
            "network",
            &origin,
            &format!("could not reach card handoff: {e}"),
        );
        "license.handoff.network".to_string()
    })?;

    let status = response.status();
    let body = response.text().map_err(|e| {
        log_handoff_error(
            "network",
            &origin,
            &format!("failed to read handoff response: {e}"),
        );
        "license.handoff.network".to_string()
    })?;

    if status.as_u16() == 404 {
        log_handoff_error(
            "expired",
            &origin,
            "handoff token missing, expired, or consumed",
        );
        return Err("license.handoff.expired".into());
    }
    if !status.is_success() {
        log_handoff_error(
            "network",
            &origin,
            &format!("card handoff returned HTTP {}", status.as_u16()),
        );
        return Err("license.handoff.network".into());
    }
    if body.trim().is_empty() {
        log_handoff_error("network", &origin, "card handoff returned an empty body");
        return Err("license.handoff.network".into());
    }

    Ok(body)
}

fn log_handoff_error(code: &str, origin: &str, message: &str) {
    activity_log::log(
        LogLevel::Error,
        "license.registration",
        format!("Spiral Card handoff failed — {message}"),
        Some(serde_json::json!({ "code": code, "origin": origin })),
    );
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
