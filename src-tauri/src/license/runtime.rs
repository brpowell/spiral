//! App-facing license state: load / install / merge `.spcard`, derive offline status.
//!
//! The registration wallet is shared at the org data root; prompt state stays
//! per-app. See spiral-powered `docs/license/spcard-v1.md` (On-disk wallet).

use super::{
    parse_and_verify_bundled, parse_and_verify_grant_bundled, reject_if_spcard_too_large,
    serialize_spcard, spiral_grant, verify_grant_signature, verifying_key_from_bytes, Cosmetic,
    Grant, LicenseError, Spcard, LICENSE_ORG_ID, LICENSE_PUBLIC_KEY_BYTES, PRODUCT_KEY_SPIRAL,
    SPCARD_MAX_GRANTS,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use super::file_lock;
use crate::settings;

/// Days after `expiresAt` during which a provisional grant stays
/// [`LicenseStatus::ReadyToUpdate`] before demotion to trial.
pub const LICENSE_GRACE_PERIOD_DAYS: i64 = 7;

/// Why the app demoted an installed card back to trial (UI copy key).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LicenseDemoted {
    Grace,
    Refunded,
}

/// Offline license status exposed to the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LicenseStatus {
    Trial,
    Provisional,
    ReadyToUpdate,
    Licensed,
}

/// Resolved wallet + per-app prompt paths.
#[derive(Debug)]
pub(crate) struct LicensePaths {
    /// `{data_dir}/com.spiralpowered/license/registration.spcard`
    pub wallet: PathBuf,
    /// Sibling lockfile for advisory exclusive locks.
    pub lock: PathBuf,
    /// `{app_data}/license/prompt-state.json` (per-app, not beside the wallet).
    pub prompt_state: PathBuf,
}

/// Single snapshot of license state for Spiral Card / gates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseSnapshot {
    pub status: LicenseStatus,
    /// True when this app has a Spiral grant on the wallet, or the wallet file
    /// exists but is corrupt/unreadable (so Reveal / replace still works).
    /// A wallet that only holds other products is `installed: false`.
    pub installed: bool,
    pub product_key: Option<String>,
    pub sku: Option<String>,
    pub original_purchase_id: Option<String>,
    pub channel: Option<String>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub cosmetic: Option<Cosmetic>,
    /// Catalog code (`license.installed.*`) when the card is missing/invalid.
    /// Frontend maps via `errors:*`; never English display copy.
    pub error: Option<String>,
    /// Set when registration was removed and the user was returned to trial.
    pub demoted: Option<LicenseDemoted>,
}

impl LicenseSnapshot {
    fn trial(installed: bool, error: Option<String>) -> Self {
        Self::trial_with_demoted(installed, error, None)
    }

    fn trial_with_demoted(
        installed: bool,
        error: Option<String>,
        demoted: Option<LicenseDemoted>,
    ) -> Self {
        Self {
            status: LicenseStatus::Trial,
            installed,
            product_key: None,
            sku: None,
            original_purchase_id: None,
            channel: None,
            issued_at: None,
            expires_at: None,
            cosmetic: None,
            error,
            demoted,
        }
    }

    fn from_card(card: &Spcard, now: DateTime<Utc>) -> Self {
        let Some(grant) = spiral_grant(card) else {
            // Wallet may hold other products; this app is still on trial.
            return Self::trial(false, None);
        };
        Self {
            status: derive_license_status(grant, now),
            installed: true,
            product_key: Some(grant.product_key.clone()),
            sku: Some(grant.sku.as_str().to_string()),
            original_purchase_id: Some(grant.original_purchase_id.clone()),
            channel: Some(grant.channel.as_str().to_string()),
            issued_at: Some(grant.issued_at.clone()),
            expires_at: grant.expires_at.clone(),
            cosmetic: Some(card.cosmetic.clone()),
            error: None,
            demoted: None,
        }
    }
}

/// Effective grace length (days). Debug builds may override via
/// `SPIRAL_LICENSE_GRACE_DAYS` (parsed as `i64`; invalid/missing → default).
fn license_grace_period_days() -> i64 {
    #[cfg(debug_assertions)]
    {
        if let Ok(raw) = std::env::var("SPIRAL_LICENSE_GRACE_DAYS") {
            if let Ok(days) = raw.parse::<i64>() {
                return days;
            }
        }
    }
    LICENSE_GRACE_PERIOD_DAYS
}

/// `true` when a provisional grant's clock is at or past `expiresAt + grace`.
fn grant_is_past_grace(grant: &Grant, now: DateTime<Utc>) -> bool {
    let Some(exp) = &grant.expires_at else {
        return false;
    };
    let Ok(dt) = DateTime::parse_from_rfc3339(exp) else {
        return false;
    };
    let expires = dt.with_timezone(&Utc);
    let grace_end = expires + Duration::days(license_grace_period_days());
    now >= grace_end
}

/// Refuse install of a verified but lapsed provisional card (catalog code).
fn reject_install_if_past_grace(card: &Spcard, now: DateTime<Utc>) -> Result<(), String> {
    let Some(grant) = spiral_grant(card) else {
        return Ok(());
    };
    if grant_is_past_grace(grant, now) {
        return Err("license.installing.expired".into());
    }
    Ok(())
}

pub(crate) fn license_paths(app: &AppHandle) -> Result<LicensePaths, String> {
    let wallet_dir = settings::user_data_dir(app)?
        .join(LICENSE_ORG_ID)
        .join("license");
    Ok(LicensePaths {
        wallet: wallet_dir.join("registration.spcard"),
        lock: wallet_dir.join("registration.spcard.lock"),
        prompt_state: settings::app_data_dir(app)?
            .join("license")
            .join("prompt-state.json"),
    })
}

/// Sidecar UI prompt state under `{app_data}/license/prompt-state.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LicensePromptState {
    /// Local calendar day (`YYYY-MM-DD`) of the last ready-to-update prompt.
    /// Used only to throttle session re-prompts while the app stays open;
    /// cold launch always prompts when status is ready-to-update.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_update_prompt_date: Option<String>,
    /// Persist grace/refund demote until the user dismisses the modal.
    /// Demotion removes this app's grant; without this, a second load looks
    /// like plain trial.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_demoted: Option<LicenseDemoted>,
}

pub fn read_license_prompt_state(app: &AppHandle) -> LicensePromptState {
    let Ok(paths) = license_paths(app) else {
        return LicensePromptState::default();
    };
    read_license_prompt_state_at(&paths.prompt_state)
}

fn read_license_prompt_state_at(path: &Path) -> LicensePromptState {
    if !path.is_file() {
        return LicensePromptState::default();
    }
    let Ok(contents) = fs::read_to_string(path) else {
        return LicensePromptState::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

pub fn write_license_prompt_state(
    app: &AppHandle,
    state: &LicensePromptState,
) -> Result<(), String> {
    let paths = license_paths(app)?;
    write_license_prompt_state_at(&paths.prompt_state, state)
}

fn write_license_prompt_state_at(path: &Path, state: &LicensePromptState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create license directory: {e}"))?;
    }
    let json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("failed to serialize license prompt state: {e}"))?;
    fs::write(path, format!("{json}\n"))
        .map_err(|e| format!("failed to write license prompt state: {e}"))
}

fn persist_pending_demoted(prompt_path: &Path, demoted: LicenseDemoted) {
    let mut state = read_license_prompt_state_at(prompt_path);
    state.pending_demoted = Some(demoted);
    let _ = write_license_prompt_state_at(prompt_path, &state);
}

fn clear_pending_demoted(prompt_path: &Path) {
    let mut state = read_license_prompt_state_at(prompt_path);
    if state.pending_demoted.is_none() {
        return;
    }
    state.pending_demoted = None;
    let _ = write_license_prompt_state_at(prompt_path, &state);
}

/// Attach a persisted demote reason when this app has no Spiral grant.
fn with_pending_demoted(mut snap: LicenseSnapshot, prompt_path: &Path) -> LicenseSnapshot {
    if snap.demoted.is_some() || snap.status != LicenseStatus::Trial {
        return snap;
    }
    if let Some(demoted) = read_license_prompt_state_at(prompt_path).pending_demoted {
        snap.demoted = Some(demoted);
    }
    snap
}

/// Absolute path to the installed registration `.spcard`, if the file exists.
pub fn registration_spcard_path_if_present(app: &AppHandle) -> Result<String, String> {
    let paths = license_paths(app)?;
    if !paths.wallet.is_file() {
        return Err("no_registration_card".into());
    }
    Ok(paths.wallet.to_string_lossy().into_owned())
}

/// Derive status from a verified Spiral grant using the local clock only.
///
/// Past-grace provisional grants are not a status — the loader demotes them.
fn derive_license_status(grant: &Grant, now: DateTime<Utc>) -> LicenseStatus {
    match &grant.expires_at {
        None => LicenseStatus::Licensed,
        Some(exp) => match DateTime::parse_from_rfc3339(exp) {
            Ok(dt) => {
                let expires = dt.with_timezone(&Utc);
                if now < expires {
                    LicenseStatus::Provisional
                } else if now < expires + Duration::days(license_grace_period_days()) {
                    LicenseStatus::ReadyToUpdate
                } else {
                    // Soft fallback if reached without demotion.
                    LicenseStatus::Trial
                }
            }
            // Validated at parse time; treat unparseable as soft trial if it slips through.
            Err(_) => LicenseStatus::Trial,
        },
    }
}

fn format_license_error(err: &LicenseError) -> String {
    format!("{}: {}", err.code, err.message)
}

/// Catalog suffix (`errors:license.{installed,installing}.*`).
///
/// Size/grant caps and malformed cards share `unreadable` with IO failures —
/// they are not distinct user-facing or activity-log categories.
fn user_facing_card_error_kind(err: &LicenseError) -> &'static str {
    match err.code {
        "unknown_field" if err.message.contains("entitlement") => "legacy_format",
        "unknown_field" | "unsupported_manifest_version" => "unrecognized",
        "invalid_signature" => "unverified",
        "unsupported_sku" | "unsupported_channel" => "unsupported",
        _ => "unreadable",
    }
}

/// Frontend catalog key for card load / install failures (never English copy).
fn user_facing_card_error_code(err: &LicenseError, installing: bool) -> String {
    let scope = if installing {
        "license.installing"
    } else {
        "license.installed"
    };
    format!("{scope}.{}", user_facing_card_error_kind(err))
}

fn log_card_error(err: &LicenseError, action: &str, installing: bool) {
    let catalog = user_facing_card_error_code(err, installing);
    let (message, details) = if user_facing_card_error_kind(err) == "unreadable" {
        (
            format!("{action} — {catalog}"),
            serde_json::json!({ "code": catalog }),
        )
    } else {
        (
            format!("{action} — {}", format_license_error(err)),
            serde_json::json!({
                "code": err.code,
                "message": err.message,
            }),
        )
    };
    crate::activity_log::log(
        crate::activity_log::LogLevel::Error,
        "license.registration",
        message,
        Some(details),
    );
}

/// Read `.spcard` text only after the on-disk size is within the contract cap.
fn read_spcard_text_capped(path: &Path) -> Result<String, LicenseError> {
    let meta = fs::metadata(path).map_err(|e| LicenseError {
        code: "unreadable",
        message: format!("could not stat .spcard: {e}"),
    })?;
    reject_if_spcard_too_large(meta.len())?;
    let json = fs::read_to_string(path).map_err(|e| LicenseError {
        code: "unreadable",
        message: format!("could not read .spcard: {e}"),
    })?;
    reject_if_spcard_too_large(json.len() as u64)?;
    Ok(json)
}

/// Advisory exclusive lock around wallet mutations. Lock is released when
/// `_guard` is dropped (file closed).
fn with_wallet_lock<T>(
    lock_path: &Path,
    f: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create license directory: {e}"))?;
    }
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock_path)
        .map_err(|e| format!("failed to open wallet lock: {e}"))?;
    file_lock::lock_exclusive(&file).map_err(|e| format!("failed to lock wallet: {e}"))?;
    let _guard = file;
    f()
}

/// Merge an incoming install into the existing wallet.
///
/// - Upsert incoming grants by `originalPurchaseId`.
/// - For each `productKey` on the incoming card, drop local grants of that key
///   whose purchase id is not in incoming.
/// - Grants for productKeys not on the incoming card stay.
/// - Incoming cosmetic wins.
fn merge_incoming_into_wallet(
    existing: Option<&Spcard>,
    incoming: &Spcard,
) -> Result<Spcard, String> {
    let incoming_keys: HashSet<&str> = incoming
        .grants
        .iter()
        .map(|g| g.product_key.as_str())
        .collect();
    let incoming_ids: HashSet<&str> = incoming
        .grants
        .iter()
        .map(|g| g.original_purchase_id.as_str())
        .collect();

    let mut grants: Vec<Grant> = existing
        .map(|c| c.grants.clone())
        .unwrap_or_default()
        .into_iter()
        .filter(|g| {
            !incoming_keys.contains(g.product_key.as_str())
                || incoming_ids.contains(g.original_purchase_id.as_str())
        })
        .collect();

    for grant in &incoming.grants {
        if let Some(idx) = grants
            .iter()
            .position(|g| g.original_purchase_id == grant.original_purchase_id)
        {
            grants[idx] = grant.clone();
        } else {
            grants.push(grant.clone());
        }
    }

    if grants.len() > SPCARD_MAX_GRANTS {
        return Err("license.installing.unreadable".into());
    }

    Ok(Spcard {
        manifest_version: incoming.manifest_version,
        grants,
        cosmetic: incoming.cosmetic.clone(),
    })
}

/// Remove every grant with `productKey === "spiral"`. Returns `None` when the
/// wallet should be deleted (no grants left).
fn remove_spiral_grants(card: Spcard) -> Option<Spcard> {
    let grants: Vec<Grant> = card
        .grants
        .into_iter()
        .filter(|g| g.product_key != PRODUCT_KEY_SPIRAL)
        .collect();
    if grants.is_empty() {
        None
    } else {
        Some(Spcard {
            manifest_version: card.manifest_version,
            grants,
            cosmetic: card.cosmetic,
        })
    }
}

fn write_or_delete_wallet(wallet: &Path, card: Option<&Spcard>) -> Result<(), String> {
    match card {
        Some(c) => write_registration_card_atomic(wallet, c),
        None => {
            if wallet.is_file() {
                fs::remove_file(wallet)
                    .map_err(|e| format!("failed to delete registration card: {e}"))?;
            }
            Ok(())
        }
    }
}

/// Remove this app's Spiral grant(s) from the wallet; delete the file when empty.
fn demote_spiral_from_wallet(
    wallet: &Path,
    prompt_path: &Path,
    demoted: LicenseDemoted,
) -> LicenseSnapshot {
    let remaining = if wallet.is_file() {
        match read_spcard_text_capped(wallet).and_then(|json| parse_and_verify_bundled(&json)) {
            Ok(card) => remove_spiral_grants(card),
            Err(e) => {
                crate::activity_log::log(
                    crate::activity_log::LogLevel::Warn,
                    "license.registration",
                    format!("Registration demote — could not read wallet, deleting: {e}"),
                    Some(serde_json::json!({ "demoted": demoted })),
                );
                let _ = fs::remove_file(wallet);
                None
            }
        }
    } else {
        None
    };

    if let Err(e) = write_or_delete_wallet(wallet, remaining.as_ref()) {
        crate::activity_log::log(
            crate::activity_log::LogLevel::Warn,
            "license.registration",
            format!("Registration demote — could not update wallet: {e}"),
            Some(serde_json::json!({ "demoted": demoted })),
        );
    }

    let log_message = match demoted {
        LicenseDemoted::Grace => "Registration expired — demoted to trial after grace period",
        LicenseDemoted::Refunded => "Registration removed — demoted to trial",
    };
    crate::activity_log::log(
        crate::activity_log::LogLevel::Info,
        "license.registration",
        log_message,
        Some(serde_json::json!({ "demoted": demoted })),
    );
    persist_pending_demoted(prompt_path, demoted);
    LicenseSnapshot::trial_with_demoted(false, None, Some(demoted))
}

fn demote_past_grace_registration(wallet: &Path, prompt_path: &Path) -> LicenseSnapshot {
    remove_registration_card_at(wallet, prompt_path, LicenseDemoted::Grace)
}

/// Load + verify the installed card (or return trial). Never panics.
pub fn load_license_snapshot(app: &AppHandle) -> Result<LicenseSnapshot, String> {
    let paths = license_paths(app)?;
    Ok(load_license_snapshot_at(
        &paths.wallet,
        &paths.prompt_state,
        Some(&paths.lock),
        Utc::now(),
    ))
}

pub(crate) fn load_license_snapshot_at(
    wallet: &Path,
    prompt_path: &Path,
    lock_path: Option<&Path>,
    now: DateTime<Utc>,
) -> LicenseSnapshot {
    if !wallet.exists() {
        return with_pending_demoted(LicenseSnapshot::trial(false, None), prompt_path);
    }

    let json = match read_spcard_text_capped(wallet) {
        Ok(s) => s,
        Err(e) => {
            log_card_error(&e, "Could not read registration card", false);
            return with_pending_demoted(
                LicenseSnapshot::trial(true, Some(user_facing_card_error_code(&e, false))),
                prompt_path,
            );
        }
    };

    match parse_and_verify_bundled(&json) {
        Ok(card) => {
            match spiral_grant(&card) {
                Some(grant) if grant_is_past_grace(grant, now) => {
                    let demote = || demote_past_grace_registration(wallet, prompt_path);
                    match lock_path {
                        Some(lock) => {
                            with_wallet_lock(lock, || Ok(demote())).unwrap_or_else(|_| demote())
                        }
                        None => demote(),
                    }
                }
                Some(_) => {
                    clear_pending_demoted(prompt_path);
                    LicenseSnapshot::from_card(&card, now)
                }
                None => {
                    // Wallet may hold other products; keep any pending demote notice.
                    with_pending_demoted(LicenseSnapshot::from_card(&card, now), prompt_path)
                }
            }
        }
        Err(e) => {
            log_card_error(&e, "Installed Spiral Card failed verification", false);
            with_pending_demoted(
                LicenseSnapshot::trial(true, Some(user_facing_card_error_code(&e, false))),
                prompt_path,
            )
        }
    }
}

/// Verify a source `.spcard`, then merge into the org wallet.
pub fn install_registration_card(
    app: &AppHandle,
    source_path: &str,
) -> Result<LicenseSnapshot, String> {
    let source = Path::new(source_path);
    if !source.is_file() {
        return Err("license.installing.not_found".into());
    }

    let json = match read_spcard_text_capped(source) {
        Ok(s) => s,
        Err(e) => {
            log_card_error(&e, "Spiral Card install rejected", true);
            return Err(user_facing_card_error_code(&e, true));
        }
    };

    install_registration_card_json(app, &json)
}

/// Verify `.spcard` JSON, then merge into the org wallet under lock.
pub fn install_registration_card_json(
    app: &AppHandle,
    json: &str,
) -> Result<LicenseSnapshot, String> {
    let card = match parse_and_verify_bundled(json) {
        Ok(card) => card,
        Err(e) => {
            log_card_error(&e, "Spiral Card install rejected", true);
            return Err(user_facing_card_error_code(&e, true));
        }
    };
    // Lapsed provisional: refuse before write so an installed card is not clobbered.
    reject_install_if_past_grace(&card, Utc::now())?;
    let paths = license_paths(app)?;
    with_wallet_lock(&paths.lock, || {
        install_registration_card_at(&paths.wallet, &paths.prompt_state, &card, Utc::now())
    })
}

pub(crate) fn install_registration_card_at(
    wallet: &Path,
    prompt_path: &Path,
    incoming: &Spcard,
    now: DateTime<Utc>,
) -> Result<LicenseSnapshot, String> {
    let existing = if wallet.is_file() {
        match read_spcard_text_capped(wallet).and_then(|json| parse_and_verify_bundled(&json)) {
            Ok(card) => Some(card),
            Err(e) => {
                // Corrupt wallet: replace with incoming rather than block install.
                log_card_error(&e, "Existing wallet unreadable during install", false);
                None
            }
        }
    } else {
        None
    };

    let merged = merge_incoming_into_wallet(existing.as_ref(), incoming)?;
    write_registration_card_atomic(wallet, &merged)?;
    clear_pending_demoted(prompt_path);
    Ok(LicenseSnapshot::from_card(&merged, now))
}

/// Remove this app's Spiral grant(s) from the wallet and return a trial snapshot.
///
/// Used by refunded grant pull (and similar). Other products' grants on the
/// shared wallet are preserved.
pub fn remove_registration_card(
    app: &AppHandle,
    demoted: LicenseDemoted,
) -> Result<LicenseSnapshot, String> {
    let paths = license_paths(app)?;
    with_wallet_lock(&paths.lock, || {
        Ok(remove_registration_card_at(
            &paths.wallet,
            &paths.prompt_state,
            demoted,
        ))
    })
}

pub(crate) fn remove_registration_card_at(
    wallet: &Path,
    prompt_path: &Path,
    demoted: LicenseDemoted,
) -> LicenseSnapshot {
    demote_spiral_from_wallet(wallet, prompt_path, demoted)
}

/// Merge a server-issued current grant into the installed `.spcard`.
///
/// Keeps local `cosmetic` and `manifestVersion`; upserts the matching grant by
/// `originalPurchaseId` (must match productKey + sku). The grant may still be
/// provisional; permanence is whatever the hub returned.
pub(crate) fn merge_current_grant(
    app: &AppHandle,
    grant: Grant,
) -> Result<LicenseSnapshot, String> {
    let paths = license_paths(app)?;
    with_wallet_lock(&paths.lock, || {
        merge_current_grant_at(&paths.wallet, grant, Utc::now())
    })
}

pub(crate) fn merge_current_grant_at(
    path: &Path,
    grant: Grant,
    now: DateTime<Utc>,
) -> Result<LicenseSnapshot, String> {
    if !path.exists() {
        return Err("no registration card installed".into());
    }

    let json = read_spcard_text_capped(path).map_err(|e| user_facing_card_error_code(&e, false))?;
    let existing =
        parse_and_verify_bundled(&json).map_err(|e| user_facing_card_error_code(&e, false))?;

    let Some(idx) = existing
        .grants
        .iter()
        .position(|g| g.original_purchase_id == grant.original_purchase_id)
    else {
        return Err(format!(
            "purchase id mismatch: incoming {} not found on installed card",
            grant.original_purchase_id
        ));
    };

    let installed = &existing.grants[idx];
    if installed.product_key != grant.product_key || installed.sku != grant.sku {
        return Err(format!(
            "grant identity mismatch: installed {}/{} vs incoming {}/{}",
            installed.product_key,
            installed.sku.as_str(),
            grant.product_key,
            grant.sku.as_str()
        ));
    }

    let key =
        verifying_key_from_bytes(LICENSE_PUBLIC_KEY_BYTES).map_err(|e| format_license_error(&e))?;
    verify_grant_signature(&grant, &key).map_err(|e| format_license_error(&e))?;

    let mut grants = existing.grants;
    grants[idx] = grant;
    let merged = Spcard {
        manifest_version: existing.manifest_version,
        grants,
        cosmetic: existing.cosmetic,
    };
    write_registration_card_atomic(path, &merged)?;
    Ok(LicenseSnapshot::from_card(&merged, now))
}

/// Parse + verify grant JSON from the current-grant HTTP response, then merge.
pub fn merge_current_grant_json(
    app: &AppHandle,
    grant_json: &str,
) -> Result<LicenseSnapshot, String> {
    let grant = parse_and_verify_grant_bundled(grant_json).map_err(|e| format_license_error(&e))?;
    merge_current_grant(app, grant)
}

fn write_registration_card_atomic(dest: &Path, card: &Spcard) -> Result<(), String> {
    let parent = dest
        .parent()
        .ok_or_else(|| format!("registration card path has no parent: {}", dest.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("failed to create license directory: {e}"))?;

    let json = serialize_spcard(card).map_err(|e| user_facing_card_error_code(&e, false))?;
    reject_if_spcard_too_large(json.len() as u64)
        .map_err(|e| user_facing_card_error_code(&e, false))?;
    let tmp = parent.join("registration.spcard.tmp");
    fs::write(&tmp, &json).map_err(|e| format!("failed to write registration card: {e}"))?;
    fs::rename(&tmp, dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("failed to install registration card: {e}")
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::license::{SPCARD_MAX_BYTES, SPCARD_MAX_GRANTS};
    use serde_json::Value;
    use std::time::Duration;

    const PERMANENT: &str = include_str!("fixtures/permanent.spcard");
    const PROVISIONAL: &str = include_str!("fixtures/provisional.spcard");
    const OTHER_PURCHASE: &str = include_str!("fixtures/other-purchase.spcard");
    const ADDON_ONLY: &str = include_str!("fixtures/addon-only.spcard");
    const SPIRAL_AND_ADDON: &str = include_str!("fixtures/spiral-and-addon.spcard");
    const PROVISIONAL_AND_ADDON: &str = include_str!("fixtures/provisional-and-addon.spcard");

    fn now_fixed() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-07-10T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn temp_dir() -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "spiral-license-test-{}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or(Duration::ZERO)
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Wallet + separate app prompt-state (mirrors production layout).
    struct TestPaths {
        root: PathBuf,
        wallet: PathBuf,
        prompt: PathBuf,
    }

    fn test_paths() -> TestPaths {
        let root = temp_dir();
        let wallet_dir = root.join("org").join("license");
        let app_dir = root.join("app").join("license");
        fs::create_dir_all(&wallet_dir).unwrap();
        fs::create_dir_all(&app_dir).unwrap();
        TestPaths {
            wallet: wallet_dir.join("registration.spcard"),
            prompt: app_dir.join("prompt-state.json"),
            root,
        }
    }

    fn load_at(paths: &TestPaths, now: DateTime<Utc>) -> LicenseSnapshot {
        load_license_snapshot_at(&paths.wallet, &paths.prompt, None, now)
    }

    #[test]
    fn permanent_fixture_is_licensed() {
        let card = parse_and_verify_bundled(PERMANENT).unwrap();
        assert_eq!(
            derive_license_status(&card.grants[0], now_fixed()),
            LicenseStatus::Licensed
        );
    }

    #[test]
    fn provisional_before_expiry_is_provisional() {
        let card = parse_and_verify_bundled(PROVISIONAL).unwrap();
        assert_eq!(
            derive_license_status(&card.grants[0], now_fixed()),
            LicenseStatus::Provisional
        );
    }

    #[test]
    fn provisional_at_or_past_expiry_is_ready_to_update() {
        let card = parse_and_verify_bundled(PROVISIONAL).unwrap();
        let at_expiry = DateTime::parse_from_rfc3339("2026-07-15T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            derive_license_status(&card.grants[0], at_expiry),
            LicenseStatus::ReadyToUpdate
        );
        // Within the default 7-day grace window (not past grace).
        let within_grace = DateTime::parse_from_rfc3339("2026-07-20T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            derive_license_status(&card.grants[0], within_grace),
            LicenseStatus::ReadyToUpdate
        );
    }

    #[test]
    fn provisional_past_grace_derive_is_trial_soft_fallback() {
        let card = parse_and_verify_bundled(PROVISIONAL).unwrap();
        let past_grace = DateTime::parse_from_rfc3339("2026-07-25T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            derive_license_status(&card.grants[0], past_grace),
            LicenseStatus::Trial
        );
        assert!(grant_is_past_grace(&card.grants[0], past_grace));
    }

    #[test]
    fn missing_file_is_trial() {
        let paths = test_paths();
        let snap = load_at(&paths, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Trial);
        assert!(!snap.installed);
        assert!(snap.error.is_none());
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn permanent_file_unlocks_offline() {
        let paths = test_paths();
        fs::write(&paths.wallet, PERMANENT).unwrap();
        let snap = load_at(&paths, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Licensed);
        assert!(snap.installed);
        assert_eq!(snap.product_key.as_deref(), Some(PRODUCT_KEY_SPIRAL));
        assert_eq!(snap.sku.as_deref(), Some("standard"));
        assert!(snap.error.is_none());
        assert!(snap.cosmetic.is_some());
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn tampered_grant_stays_trial_with_error() {
        let paths = test_paths();
        let mut value: serde_json::Value = serde_json::from_str(PERMANENT).unwrap();
        value["grants"][0]["productKey"] = serde_json::Value::String("spirax".into());
        fs::write(&paths.wallet, value.to_string()).unwrap();
        let snap = load_at(&paths, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Trial);
        assert!(snap.installed);
        let err = snap.error.as_ref().unwrap();
        assert_eq!(err, "license.installed.unverified");
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn legacy_entitlement_card_gets_clear_user_error() {
        let paths = test_paths();
        let legacy = serde_json::json!({
            "manifestVersion": 1,
            "entitlement": {
                "productKey": "spiral",
                "originalPurchaseId": "old",
                "channel": "direct",
                "issuedAt": "2026-07-01T12:00:00Z",
                "expiresAt": null,
                "signature": "AAAA"
            },
            "cosmetic": {
                "fontId": "mono-01",
                "colorHex": "#2b2b2b",
                "cardholderName": ""
            }
        });
        fs::write(&paths.wallet, legacy.to_string()).unwrap();
        let snap = load_at(&paths, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Trial);
        assert!(snap.installed);
        let err = snap.error.as_ref().unwrap();
        assert_eq!(err, "license.installed.legacy_format");
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn card_error_codes_are_stable_catalog_keys() {
        let unverified = LicenseError {
            code: "invalid_signature",
            message: "bad sig".into(),
        };
        assert_eq!(
            user_facing_card_error_code(&unverified, false),
            "license.installed.unverified"
        );
        assert_eq!(
            user_facing_card_error_code(&unverified, true),
            "license.installing.unverified"
        );
        let legacy = LicenseError {
            code: "unknown_field",
            message: "unknown field entitlement".into(),
        };
        assert_eq!(
            user_facing_card_error_code(&legacy, false),
            "license.installed.legacy_format"
        );
    }

    #[test]
    fn wrecked_cosmetic_still_unlocks_with_defaults() {
        let paths = test_paths();
        let mut value: serde_json::Value = serde_json::from_str(PERMANENT).unwrap();
        value["cosmetic"] = serde_json::json!({
            "fontId": "not-a-font",
            "colorHex": "red"
        });
        fs::write(&paths.wallet, value.to_string()).unwrap();
        let snap = load_at(&paths, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Licensed);
        let cosmetic = snap.cosmetic.unwrap();
        assert_eq!(cosmetic.font_id, "mono-01");
        assert_eq!(cosmetic.color_hex, "#2b2b2b");
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn clock_past_expires_at_ready_to_update_no_network() {
        let paths = test_paths();
        fs::write(&paths.wallet, PROVISIONAL).unwrap();
        // 5 days after expiry — still inside the 7-day grace window.
        let within_grace = DateTime::parse_from_rfc3339("2026-07-20T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let snap = load_at(&paths, within_grace);
        assert_eq!(snap.status, LicenseStatus::ReadyToUpdate);
        assert_eq!(snap.expires_at.as_deref(), Some("2026-07-15T12:00:00Z"));
        assert!(paths.wallet.is_file());
        assert!(snap.demoted.is_none());
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn past_grace_demotes_removes_spiral_and_sets_demoted() {
        let paths = test_paths();
        fs::write(&paths.wallet, PROVISIONAL).unwrap();
        // 10 days after expiry — past the 7-day grace window.
        let past_grace = DateTime::parse_from_rfc3339("2026-07-25T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut snap = load_at(&paths, past_grace);
        assert_eq!(snap.status, LicenseStatus::Trial);
        assert!(!snap.installed);
        assert_eq!(snap.demoted, Some(LicenseDemoted::Grace));
        assert!(snap.error.is_none());
        assert!(!paths.wallet.exists());
        // Second load (e.g. React Strict Mode remount) still surfaces demoted.
        snap = load_at(&paths, past_grace);
        assert_eq!(snap.demoted, Some(LicenseDemoted::Grace));
        let prompt = read_license_prompt_state_at(&paths.prompt);
        assert_eq!(prompt.pending_demoted, Some(LicenseDemoted::Grace));
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn refuse_install_of_lapsed_provisional_before_write() {
        let card = parse_and_verify_bundled(PROVISIONAL).unwrap();
        let past_grace = DateTime::parse_from_rfc3339("2026-07-25T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let err = reject_install_if_past_grace(&card, past_grace).unwrap_err();
        assert_eq!(err, "license.installing.expired");

        // Existing installed card must not be clobbered when install is refused.
        let paths = test_paths();
        fs::write(&paths.wallet, PERMANENT).unwrap();
        let before = fs::read_to_string(&paths.wallet).unwrap();
        assert!(reject_install_if_past_grace(&card, past_grace).is_err());
        assert_eq!(fs::read_to_string(&paths.wallet).unwrap(), before);
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn remove_registration_card_at_returns_trial_with_demoted() {
        let paths = test_paths();
        fs::write(&paths.wallet, PERMANENT).unwrap();
        let snap =
            remove_registration_card_at(&paths.wallet, &paths.prompt, LicenseDemoted::Refunded);
        assert_eq!(snap.status, LicenseStatus::Trial);
        assert!(!snap.installed);
        assert_eq!(snap.demoted, Some(LicenseDemoted::Refunded));
        assert!(!paths.wallet.exists());
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn license_prompt_state_json_uses_camel_case() {
        let state = LicensePromptState {
            last_update_prompt_date: Some("2026-09-15".into()),
            pending_demoted: Some(LicenseDemoted::Grace),
        };
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("lastUpdatePromptDate"));
        assert!(json.contains("pendingDemoted"));
        assert!(!json.contains("last_update_prompt_date"));
        let back: LicensePromptState = serde_json::from_str(&json).unwrap();
        assert_eq!(back, state);
        let empty: LicensePromptState = serde_json::from_str("{}").unwrap();
        assert_eq!(empty, LicensePromptState::default());
    }

    #[test]
    fn install_expired_is_clean_catalog_code_not_unreadable() {
        // Ensure the expired code is returned as-is (not remapped via LicenseError).
        let card = parse_and_verify_bundled(PROVISIONAL).unwrap();
        let past_grace = DateTime::parse_from_rfc3339("2026-07-22T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        // Exactly at grace end (expires + 7d) is past grace.
        assert!(grant_is_past_grace(&card.grants[0], past_grace));
        assert_eq!(
            reject_install_if_past_grace(&card, past_grace).unwrap_err(),
            "license.installing.expired"
        );
    }

    fn fixture_card(json: &str) -> Spcard {
        parse_and_verify_bundled(json).unwrap()
    }

    fn fixture_grant(json: &str) -> Grant {
        fixture_card(json).grants.into_iter().next().unwrap()
    }

    #[test]
    fn atomic_write_round_trip_preserves_state() {
        let card = fixture_card(PERMANENT);
        let paths = test_paths();
        write_registration_card_atomic(&paths.wallet, &card).unwrap();
        let snap = load_at(&paths, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Licensed);
        assert_eq!(
            snap.original_purchase_id.as_deref(),
            Some("poc-direct-0001")
        );
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn merge_current_grant_preserves_cosmetic() {
        let custom_cosmetic = Cosmetic {
            font_id: "mono-01".to_string(),
            color_hex: "#ff5500".to_string(),
            cardholder_name: String::new(),
        };
        let mut value: Value = serde_json::from_str(PROVISIONAL).unwrap();
        value["cosmetic"]["colorHex"] = Value::String(custom_cosmetic.color_hex.clone());
        let provisional = parse_and_verify_bundled(&value.to_string()).unwrap();

        let paths = test_paths();
        write_registration_card_atomic(&paths.wallet, &provisional).unwrap();

        let permanent = fixture_grant(PERMANENT);

        let snap = merge_current_grant_at(&paths.wallet, permanent.clone(), now_fixed()).unwrap();
        assert_eq!(snap.status, LicenseStatus::Licensed);
        assert_eq!(snap.cosmetic.as_ref(), Some(&custom_cosmetic));
        assert_eq!(snap.expires_at, None);
        assert_eq!(snap.sku.as_deref(), Some("standard"));
        assert_eq!(
            snap.original_purchase_id.as_deref(),
            Some("poc-direct-0001")
        );

        let reloaded = load_at(&paths, now_fixed());
        assert_eq!(reloaded.cosmetic.as_ref(), Some(&custom_cosmetic));
        assert_eq!(reloaded.status, LicenseStatus::Licensed);

        let on_disk = fs::read_to_string(&paths.wallet).unwrap();
        let card = parse_and_verify_bundled(&on_disk).unwrap();
        assert_eq!(card.cosmetic, custom_cosmetic);
        assert_eq!(card.grants[0], permanent);
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn merge_current_grant_accepts_provisional() {
        let card = fixture_card(PROVISIONAL);
        let paths = test_paths();
        write_registration_card_atomic(&paths.wallet, &card).unwrap();

        let incoming = fixture_grant(PROVISIONAL);
        let snap = merge_current_grant_at(&paths.wallet, incoming.clone(), now_fixed()).unwrap();
        assert_eq!(snap.status, LicenseStatus::Provisional);
        assert_eq!(snap.expires_at, incoming.expires_at);

        let on_disk = fs::read_to_string(&paths.wallet).unwrap();
        let reloaded = parse_and_verify_bundled(&on_disk).unwrap();
        assert_eq!(reloaded.grants[0], incoming);
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn oversized_file_is_trial_with_unreadable_error() {
        let paths = test_paths();
        let blob = "x".repeat(SPCARD_MAX_BYTES + 1);
        fs::write(&paths.wallet, blob).unwrap();
        let snap = load_at(&paths, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Trial);
        assert!(snap.installed);
        assert_eq!(snap.error.as_deref(), Some("license.installed.unreadable"));
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn too_many_grants_is_trial_with_unreadable_error() {
        let paths = test_paths();
        let mut value: serde_json::Value = serde_json::from_str(PERMANENT).unwrap();
        let grant = value["grants"][0].clone();
        value["grants"] = serde_json::Value::Array(vec![grant; SPCARD_MAX_GRANTS + 1]);
        fs::write(&paths.wallet, value.to_string()).unwrap();
        let snap = load_at(&paths, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Trial);
        assert!(snap.installed);
        assert_eq!(snap.error.as_deref(), Some("license.installed.unreadable"));
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn grants_at_cap_still_unlock() {
        let paths = test_paths();
        let mut value: serde_json::Value = serde_json::from_str(PERMANENT).unwrap();
        let grant = value["grants"][0].clone();
        value["grants"] = serde_json::Value::Array(vec![grant; SPCARD_MAX_GRANTS]);
        fs::write(&paths.wallet, value.to_string()).unwrap();
        let snap = load_at(&paths, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Licensed);
        assert!(snap.error.is_none());
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn card_error_codes_map_size_grants_and_invalid_to_unreadable() {
        let too_large = LicenseError {
            code: "spcard_too_large",
            message: "big".into(),
        };
        assert_eq!(
            user_facing_card_error_code(&too_large, true),
            "license.installing.unreadable"
        );
        let too_many = LicenseError {
            code: "too_many_grants",
            message: "many".into(),
        };
        assert_eq!(
            user_facing_card_error_code(&too_many, false),
            "license.installed.unreadable"
        );
        let malformed = LicenseError {
            code: "invalid_json",
            message: "not json".into(),
        };
        assert_eq!(
            user_facing_card_error_code(&malformed, true),
            "license.installing.unreadable"
        );
    }

    #[test]
    fn merge_rejects_purchase_id_mismatch() {
        let card = fixture_card(PROVISIONAL);
        let paths = test_paths();
        write_registration_card_atomic(&paths.wallet, &card).unwrap();

        let other = fixture_grant(OTHER_PURCHASE);
        let err = merge_current_grant_at(&paths.wallet, other, now_fixed()).unwrap_err();
        assert!(err.contains("purchase id mismatch"));
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn addon_only_wallet_is_trial_not_installed() {
        let paths = test_paths();
        fs::write(&paths.wallet, ADDON_ONLY).unwrap();
        let snap = load_at(&paths, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Trial);
        assert!(!snap.installed);
        assert!(snap.error.is_none());
        assert!(paths.wallet.is_file());
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn install_spiral_into_addon_wallet_keeps_addon() {
        let paths = test_paths();
        fs::write(&paths.wallet, ADDON_ONLY).unwrap();
        let incoming = fixture_card(PERMANENT);
        let snap =
            install_registration_card_at(&paths.wallet, &paths.prompt, &incoming, now_fixed())
                .unwrap();
        assert_eq!(snap.status, LicenseStatus::Licensed);
        assert!(snap.installed);

        let on_disk =
            parse_and_verify_bundled(&fs::read_to_string(&paths.wallet).unwrap()).unwrap();
        assert_eq!(on_disk.grants.len(), 2);
        assert!(on_disk
            .grants
            .iter()
            .any(|g| g.product_key == PRODUCT_KEY_SPIRAL));
        assert!(on_disk.grants.iter().any(|g| g.product_key == "spirax"));
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn reinstall_spiral_replaces_old_spiral_keeps_addon() {
        let paths = test_paths();
        fs::write(&paths.wallet, SPIRAL_AND_ADDON).unwrap();
        let incoming = fixture_card(OTHER_PURCHASE);
        let snap =
            install_registration_card_at(&paths.wallet, &paths.prompt, &incoming, now_fixed())
                .unwrap();
        assert_eq!(
            snap.original_purchase_id.as_deref(),
            Some("poc-direct-other")
        );

        let on_disk =
            parse_and_verify_bundled(&fs::read_to_string(&paths.wallet).unwrap()).unwrap();
        assert_eq!(on_disk.grants.len(), 2);
        let spiral: Vec<_> = on_disk
            .grants
            .iter()
            .filter(|g| g.product_key == PRODUCT_KEY_SPIRAL)
            .collect();
        assert_eq!(spiral.len(), 1);
        assert_eq!(spiral[0].original_purchase_id, "poc-direct-other");
        assert!(on_disk.grants.iter().any(|g| g.product_key == "spirax"));
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn past_grace_keeps_addon_grants_and_prompt_state() {
        let paths = test_paths();
        fs::write(&paths.wallet, PROVISIONAL_AND_ADDON).unwrap();
        let past_grace = DateTime::parse_from_rfc3339("2026-07-25T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let snap = load_at(&paths, past_grace);
        assert_eq!(snap.status, LicenseStatus::Trial);
        assert!(!snap.installed);
        assert_eq!(snap.demoted, Some(LicenseDemoted::Grace));
        assert!(paths.wallet.is_file());

        let on_disk =
            parse_and_verify_bundled(&fs::read_to_string(&paths.wallet).unwrap()).unwrap();
        assert_eq!(on_disk.grants.len(), 1);
        assert_eq!(on_disk.grants[0].product_key, "spirax");

        let prompt = read_license_prompt_state_at(&paths.prompt);
        assert_eq!(prompt.pending_demoted, Some(LicenseDemoted::Grace));
        let _ = fs::remove_dir_all(&paths.root);
    }

    #[test]
    fn refund_remove_keeps_addon_deletes_when_empty() {
        let paths = test_paths();
        fs::write(&paths.wallet, SPIRAL_AND_ADDON).unwrap();
        let snap =
            remove_registration_card_at(&paths.wallet, &paths.prompt, LicenseDemoted::Refunded);
        assert_eq!(snap.demoted, Some(LicenseDemoted::Refunded));
        assert!(paths.wallet.is_file());
        let on_disk =
            parse_and_verify_bundled(&fs::read_to_string(&paths.wallet).unwrap()).unwrap();
        assert_eq!(on_disk.grants.len(), 1);
        assert_eq!(on_disk.grants[0].product_key, "spirax");

        // Remove again with only addon left — spiral already gone; file stays.
        let snap2 =
            remove_registration_card_at(&paths.wallet, &paths.prompt, LicenseDemoted::Refunded);
        assert!(!snap2.installed);
        assert!(paths.wallet.is_file());

        // Spiral-only wallet → file deleted.
        let paths2 = test_paths();
        fs::write(&paths2.wallet, PERMANENT).unwrap();
        let _ =
            remove_registration_card_at(&paths2.wallet, &paths2.prompt, LicenseDemoted::Refunded);
        assert!(!paths2.wallet.exists());
        let _ = fs::remove_dir_all(&paths.root);
        let _ = fs::remove_dir_all(&paths2.root);
    }

    #[test]
    fn merge_incoming_pure_keeps_unrelated_product() {
        let existing = fixture_card(ADDON_ONLY);
        let incoming = fixture_card(PERMANENT);
        let merged = merge_incoming_into_wallet(Some(&existing), &incoming).unwrap();
        assert_eq!(merged.grants.len(), 2);
        assert_eq!(merged.cosmetic, incoming.cosmetic);
    }
}
