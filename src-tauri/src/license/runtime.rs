//! App-facing license state: load / install / merge `.spcard`, derive offline status.

use super::wrap::sanitize_wrap_image_bytes;
use super::{
    parse_and_verify_grant_poc, parse_and_verify_poc, prepare_cosmetic_for_write, serialize_spcard,
    spiral_grant, verify_grant_signature, verifying_key_from_bytes, Cosmetic, Grant, LicenseError,
    Spcard, POC_PUBLIC_KEY_BYTES, PRODUCT_ID_SPIRAL,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::settings;

/// Offline license status exposed to the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LicenseStatus {
    Trial,
    Provisional,
    ReadyToFinalize,
    Licensed,
}

/// Single snapshot of license state for Spiral Card / gates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseSnapshot {
    pub status: LicenseStatus,
    /// True when a registration file exists on disk (even if invalid).
    pub installed: bool,
    pub product_id: Option<String>,
    pub sku: Option<String>,
    pub original_purchase_id: Option<String>,
    pub channel: Option<String>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub cosmetic: Option<Cosmetic>,
    /// Catalog code (`license.installed.*`) when the card is missing/invalid.
    /// Frontend maps via `errors:*`; never English display copy.
    pub error: Option<String>,
}

impl LicenseSnapshot {
    fn trial(installed: bool, error: Option<String>) -> Self {
        Self {
            status: LicenseStatus::Trial,
            installed,
            product_id: None,
            sku: None,
            original_purchase_id: None,
            channel: None,
            issued_at: None,
            expires_at: None,
            cosmetic: None,
            error,
        }
    }

    fn from_card(card: &Spcard, now: DateTime<Utc>) -> Self {
        let Some(grant) = spiral_grant(card) else {
            crate::activity_log::log(
                crate::activity_log::LogLevel::Error,
                "license.registration",
                format!("invalid_spcard: no grant for productId {PRODUCT_ID_SPIRAL}"),
                Some(serde_json::json!({ "productId": PRODUCT_ID_SPIRAL })),
            );
            return Self::trial(true, Some("license.installed.invalid".into()));
        };
        Self {
            status: derive_license_status(grant, now),
            installed: true,
            product_id: Some(grant.product_id.clone()),
            sku: Some(grant.sku.as_str().to_string()),
            original_purchase_id: Some(grant.original_purchase_id.clone()),
            channel: Some(grant.channel.as_str().to_string()),
            issued_at: Some(grant.issued_at.clone()),
            expires_at: grant.expires_at.clone(),
            cosmetic: Some(card.cosmetic.clone()),
            error: None,
        }
    }
}

/// `{app_data}/license/registration.spcard`
fn registration_spcard_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings::app_data_dir(app)?
        .join("license")
        .join("registration.spcard"))
}

/// Absolute path to the installed registration `.spcard`, if the file exists.
pub fn registration_spcard_path_if_present(app: &AppHandle) -> Result<String, String> {
    let path = registration_spcard_path(app)?;
    if !path.is_file() {
        return Err("no_registration_card".into());
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Derive status from a verified Spiral grant using the local clock only.
fn derive_license_status(grant: &Grant, now: DateTime<Utc>) -> LicenseStatus {
    match &grant.expires_at {
        None => LicenseStatus::Licensed,
        Some(exp) => match DateTime::parse_from_rfc3339(exp) {
            Ok(dt) if dt.with_timezone(&Utc) <= now => LicenseStatus::ReadyToFinalize,
            Ok(_) => LicenseStatus::Provisional,
            // Validated at parse time; treat unparseable as soft trial if it slips through.
            Err(_) => LicenseStatus::Trial,
        },
    }
}

fn format_license_error(err: &LicenseError) -> String {
    format!("{}: {}", err.code, err.message)
}

/// Frontend catalog key for card load / install failures (never English copy).
/// Logs keep `format_license_error`; the UI maps these codes via `errors:*`.
fn user_facing_card_error_code(err: &LicenseError, installing: bool) -> String {
    let kind = match err.code {
        "unknown_field" if err.message.contains("entitlement") => "legacy_format",
        "unknown_field" | "unsupported_manifest_version" => "unrecognized",
        "invalid_signature" => "unverified",
        "unsupported_sku" | "unsupported_channel" => "unsupported",
        "invalid_json" | "invalid_spcard" | "invalid_grant" | "missing_manifest_version" => {
            "invalid"
        }
        _ => "unreadable",
    };
    let scope = if installing {
        "license.installing"
    } else {
        "license.installed"
    };
    format!("{scope}.{kind}")
}

fn log_card_error(err: &LicenseError, action: &str) {
    crate::activity_log::log(
        crate::activity_log::LogLevel::Error,
        "license.registration",
        format!("{action} — {}", format_license_error(err)),
        Some(serde_json::json!({
            "code": err.code,
            "message": err.message,
        })),
    );
}

/// Load + verify the installed card (or return trial). Never panics.
pub fn load_license_snapshot(app: &AppHandle) -> Result<LicenseSnapshot, String> {
    let path = registration_spcard_path(app)?;
    Ok(load_license_snapshot_at(&path, Utc::now()))
}

pub(crate) fn load_license_snapshot_at(path: &Path, now: DateTime<Utc>) -> LicenseSnapshot {
    if !path.exists() {
        return LicenseSnapshot::trial(false, None);
    }

    let json = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => {
            crate::activity_log::log(
                crate::activity_log::LogLevel::Error,
                "license.registration",
                format!("Could not read registration card — {e}"),
                None,
            );
            return LicenseSnapshot::trial(true, Some("license.installed.unreadable".into()));
        }
    };

    match parse_and_verify_poc(&json) {
        Ok(card) => LicenseSnapshot::from_card(&card, now),
        Err(e) => {
            log_card_error(&e, "Installed Spiral Card failed verification");
            LicenseSnapshot::trial(true, Some(user_facing_card_error_code(&e, false)))
        }
    }
}

/// Verify a source `.spcard`, then atomically write it to the install path.
pub fn install_registration_card(
    app: &AppHandle,
    source_path: &str,
) -> Result<LicenseSnapshot, String> {
    let source = Path::new(source_path);
    if !source.is_file() {
        return Err("license.installing.not_found".into());
    }

    let json = fs::read_to_string(source).map_err(|e| {
        crate::activity_log::log(
            crate::activity_log::LogLevel::Error,
            "license.registration",
            format!("Failed to read Spiral Card for install — {e}"),
            Some(serde_json::json!({ "path": source_path })),
        );
        "license.installing.unreadable".to_string()
    })?;

    let card = match parse_and_verify_poc(&json) {
        Ok(card) => card,
        Err(e) => {
            log_card_error(&e, "Spiral Card install rejected");
            return Err(user_facing_card_error_code(&e, true));
        }
    };
    let dest = registration_spcard_path(app)?;
    write_registration_card_atomic(&dest, &card)?;
    Ok(LicenseSnapshot::from_card(&card, Utc::now()))
}

/// Merge a server-issued permanent grant into the installed `.spcard`.
///
/// Keeps local `cosmetic` and `manifestVersion`; upserts the matching grant by
/// `originalPurchaseId` (must match productId + sku).
pub(crate) fn merge_finalized_grant(
    app: &AppHandle,
    grant: Grant,
) -> Result<LicenseSnapshot, String> {
    let dest = registration_spcard_path(app)?;
    merge_finalized_grant_at(&dest, grant, Utc::now())
}

pub(crate) fn merge_finalized_grant_at(
    path: &Path,
    grant: Grant,
    now: DateTime<Utc>,
) -> Result<LicenseSnapshot, String> {
    if !path.exists() {
        return Err("no registration card installed".into());
    }

    let json =
        fs::read_to_string(path).map_err(|e| format!("failed to read registration card: {e}"))?;
    let existing = parse_and_verify_poc(&json).map_err(|e| format_license_error(&e))?;

    let Some(idx) = existing
        .grants
        .iter()
        .position(|g| g.original_purchase_id == grant.original_purchase_id)
    else {
        return Err(format!(
            "purchase id mismatch: finalized {} not found on installed card",
            grant.original_purchase_id
        ));
    };

    let installed = &existing.grants[idx];
    if installed.product_id != grant.product_id || installed.sku != grant.sku {
        return Err(format!(
            "grant identity mismatch: installed {}/{} vs finalized {}/{}",
            installed.product_id,
            installed.sku.as_str(),
            grant.product_id,
            grant.sku.as_str()
        ));
    }

    let key =
        verifying_key_from_bytes(POC_PUBLIC_KEY_BYTES).map_err(|e| format_license_error(&e))?;
    verify_grant_signature(&grant, &key).map_err(|e| format_license_error(&e))?;

    if grant.expires_at.is_some() {
        return Err("finalized grant must have expiresAt null".into());
    }

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

/// Parse + verify grant JSON from the finalize HTTP response, then merge.
pub fn merge_finalized_grant_json(
    app: &AppHandle,
    grant_json: &str,
) -> Result<LicenseSnapshot, String> {
    let grant = parse_and_verify_grant_poc(grant_json).map_err(|e| format_license_error(&e))?;
    merge_finalized_grant(app, grant)
}

/// Replace local `cosmetic` on the installed card. Never mutates grants.
pub fn update_registration_cosmetic(
    app: &AppHandle,
    cosmetic: Cosmetic,
) -> Result<LicenseSnapshot, String> {
    let dest = registration_spcard_path(app)?;
    update_registration_cosmetic_at(&dest, cosmetic, Utc::now())
}

pub(crate) fn update_registration_cosmetic_at(
    path: &Path,
    cosmetic: Cosmetic,
    now: DateTime<Utc>,
) -> Result<LicenseSnapshot, String> {
    if !path.exists() {
        return Err("no registration card installed".into());
    }

    let json =
        fs::read_to_string(path).map_err(|e| format!("failed to read registration card: {e}"))?;
    let existing = parse_and_verify_poc(&json).map_err(|e| format_license_error(&e))?;

    let repaired = prepare_cosmetic_for_write(cosmetic).map_err(|e| format_license_error(&e))?;

    let updated = Spcard {
        manifest_version: existing.manifest_version,
        grants: existing.grants,
        cosmetic: repaired,
    };
    write_registration_card_atomic(path, &updated)?;
    Ok(LicenseSnapshot::from_card(&updated, now))
}

/// Set custom wrap from raw image bytes (re-encode pipeline). Preserves other cosmetics.
pub fn set_registration_wrap_from_bytes(
    app: &AppHandle,
    image_bytes: &[u8],
) -> Result<LicenseSnapshot, String> {
    let dest = registration_spcard_path(app)?;
    set_registration_wrap_from_bytes_at(&dest, image_bytes, Utc::now())
}

pub(crate) fn set_registration_wrap_from_bytes_at(
    path: &Path,
    image_bytes: &[u8],
    now: DateTime<Utc>,
) -> Result<LicenseSnapshot, String> {
    if !path.exists() {
        return Err("no registration card installed".into());
    }

    let json =
        fs::read_to_string(path).map_err(|e| format!("failed to read registration card: {e}"))?;
    let existing = parse_and_verify_poc(&json).map_err(|e| format_license_error(&e))?;
    let jpeg = sanitize_wrap_image_bytes(image_bytes).map_err(|e| format_license_error(&e))?;

    let next = Cosmetic {
        font_id: existing.cosmetic.font_id.clone(),
        color_hex: existing.cosmetic.color_hex.clone(),
        cardholder_name: existing.cosmetic.cardholder_name.clone(),
        wrap_ref: "custom".to_string(),
        wrap_data: Some(BASE64.encode(&jpeg)),
    };
    update_registration_cosmetic_at(path, next, now)
}

/// Clear custom wrap back to the default preset (keeps cardholder name / color / font).
pub fn clear_registration_wrap(app: &AppHandle) -> Result<LicenseSnapshot, String> {
    let snap = load_license_snapshot(app)?;
    let Some(cosmetic) = snap.cosmetic else {
        return Err("no registration card installed".into());
    };
    update_registration_cosmetic(
        app,
        Cosmetic {
            font_id: cosmetic.font_id,
            color_hex: cosmetic.color_hex,
            cardholder_name: cosmetic.cardholder_name,
            wrap_ref: "default".to_string(),
            wrap_data: None,
        },
    )
}

fn write_registration_card_atomic(dest: &Path, card: &Spcard) -> Result<(), String> {
    let parent = dest
        .parent()
        .ok_or_else(|| format!("registration card path has no parent: {}", dest.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("failed to create license directory: {e}"))?;

    let json = serialize_spcard(card).map_err(|e| format_license_error(&e))?;
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
    use crate::license::{
        mint_grant, mint_spcard, signing_key_from_bytes, Cosmetic, LicenseChannel, LicenseError,
        LicenseSku, PRODUCT_ID_SPIRAL,
    };
    use std::time::Duration;

    const PERMANENT: &str = include_str!("../../../docs/license/examples/permanent.spcard");
    const PROVISIONAL: &str = include_str!("../../../docs/license/examples/provisional.spcard");
    const POC_PRIVATE_KEY: &[u8; 32] =
        include_bytes!("../../../docs/license/poc-keys/ed25519-private.raw");

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

    #[test]
    fn permanent_fixture_is_licensed() {
        let card = parse_and_verify_poc(PERMANENT).unwrap();
        assert_eq!(
            derive_license_status(&card.grants[0], now_fixed()),
            LicenseStatus::Licensed
        );
    }

    #[test]
    fn provisional_before_expiry_is_provisional() {
        let card = parse_and_verify_poc(PROVISIONAL).unwrap();
        assert_eq!(
            derive_license_status(&card.grants[0], now_fixed()),
            LicenseStatus::Provisional
        );
    }

    #[test]
    fn provisional_at_or_past_expiry_is_ready_to_finalize() {
        let card = parse_and_verify_poc(PROVISIONAL).unwrap();
        let at_expiry = DateTime::parse_from_rfc3339("2026-07-15T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            derive_license_status(&card.grants[0], at_expiry),
            LicenseStatus::ReadyToFinalize
        );
        let past = DateTime::parse_from_rfc3339("2026-07-25T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            derive_license_status(&card.grants[0], past),
            LicenseStatus::ReadyToFinalize
        );
    }

    #[test]
    fn missing_file_is_trial() {
        let dir = temp_dir();
        let path = dir.join("registration.spcard");
        let snap = load_license_snapshot_at(&path, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Trial);
        assert!(!snap.installed);
        assert!(snap.error.is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn permanent_file_unlocks_offline() {
        let dir = temp_dir();
        let path = dir.join("registration.spcard");
        fs::write(&path, PERMANENT).unwrap();
        let snap = load_license_snapshot_at(&path, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Licensed);
        assert!(snap.installed);
        assert_eq!(snap.product_id.as_deref(), Some(PRODUCT_ID_SPIRAL));
        assert_eq!(snap.sku.as_deref(), Some("standard"));
        assert!(snap.error.is_none());
        assert!(snap.cosmetic.is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tampered_grant_stays_trial_with_error() {
        let dir = temp_dir();
        let path = dir.join("registration.spcard");
        let mut value: serde_json::Value = serde_json::from_str(PERMANENT).unwrap();
        value["grants"][0]["productId"] = serde_json::Value::String("spirax".into());
        fs::write(&path, value.to_string()).unwrap();
        let snap = load_license_snapshot_at(&path, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Trial);
        assert!(snap.installed);
        let err = snap.error.as_ref().unwrap();
        assert_eq!(err, "license.installed.unverified");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_entitlement_card_gets_clear_user_error() {
        let dir = temp_dir();
        let path = dir.join("registration.spcard");
        let legacy = serde_json::json!({
            "manifestVersion": 1,
            "entitlement": {
                "productId": "spiral",
                "originalPurchaseId": "old",
                "channel": "direct",
                "issuedAt": "2026-07-01T12:00:00Z",
                "expiresAt": null,
                "signature": "AAAA"
            },
            "cosmetic": {
                "fontId": "mono-01",
                "colorHex": "#2b2b2b",
                "cardholderName": "",
                "wrapRef": "default",
                "wrapData": null
            }
        });
        fs::write(&path, legacy.to_string()).unwrap();
        let snap = load_license_snapshot_at(&path, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Trial);
        assert!(snap.installed);
        let err = snap.error.as_ref().unwrap();
        assert_eq!(err, "license.installed.legacy_format");
        let _ = fs::remove_dir_all(&dir);
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
        let dir = temp_dir();
        let path = dir.join("registration.spcard");
        let mut value: serde_json::Value = serde_json::from_str(PERMANENT).unwrap();
        value["cosmetic"] = serde_json::json!({
            "fontId": "not-a-font",
            "colorHex": "red",
            "wrapRef": "nope"
        });
        fs::write(&path, value.to_string()).unwrap();
        let snap = load_license_snapshot_at(&path, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Licensed);
        let cosmetic = snap.cosmetic.unwrap();
        assert_eq!(cosmetic.font_id, "mono-01");
        assert_eq!(cosmetic.color_hex, "#2b2b2b");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn clock_past_expires_at_ready_to_finalize_no_network() {
        let dir = temp_dir();
        let path = dir.join("registration.spcard");
        fs::write(&path, PROVISIONAL).unwrap();
        let past = DateTime::parse_from_rfc3339("2026-07-25T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let snap = load_license_snapshot_at(&path, past);
        assert_eq!(snap.status, LicenseStatus::ReadyToFinalize);
        assert_eq!(snap.expires_at.as_deref(), Some("2026-07-15T12:00:00Z"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_round_trip_preserves_state() {
        let key = signing_key_from_bytes(POC_PRIVATE_KEY).unwrap();
        let card = mint_spcard(
            &key,
            "spiral",
            LicenseSku::Standard,
            "phase2-roundtrip",
            LicenseChannel::Direct,
            "2026-07-25T12:00:00Z",
            None,
        )
        .unwrap();
        let dir = temp_dir();
        let path = dir.join("registration.spcard");
        write_registration_card_atomic(&path, &card).unwrap();
        let snap = load_license_snapshot_at(&path, now_fixed());
        assert_eq!(snap.status, LicenseStatus::Licensed);
        assert_eq!(
            snap.original_purchase_id.as_deref(),
            Some("phase2-roundtrip")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn merge_finalized_preserves_cosmetic() {
        let key = signing_key_from_bytes(POC_PRIVATE_KEY).unwrap();
        let custom_cosmetic = Cosmetic {
            font_id: "mono-01".to_string(),
            color_hex: "#ff5500".to_string(),
            cardholder_name: String::new(),
            wrap_ref: "default".to_string(),
            wrap_data: None,
        };
        let provisional = Spcard {
            manifest_version: 1,
            grants: vec![mint_grant(
                &key,
                "spiral",
                LicenseSku::Founder,
                "merge-cosmetic-001",
                LicenseChannel::Direct,
                "2026-07-01T12:00:00Z",
                Some("2026-07-15T12:00:00Z".into()),
            )
            .unwrap()],
            cosmetic: custom_cosmetic.clone(),
        };

        let dir = temp_dir();
        let path = dir.join("registration.spcard");
        write_registration_card_atomic(&path, &provisional).unwrap();

        let permanent = mint_grant(
            &key,
            "spiral",
            LicenseSku::Founder,
            "merge-cosmetic-001",
            LicenseChannel::Direct,
            "2026-07-20T12:00:00Z",
            None,
        )
        .unwrap();

        let snap = merge_finalized_grant_at(&path, permanent.clone(), now_fixed()).unwrap();
        assert_eq!(snap.status, LicenseStatus::Licensed);
        assert_eq!(snap.cosmetic.as_ref(), Some(&custom_cosmetic));
        assert_eq!(snap.expires_at, None);
        assert_eq!(snap.sku.as_deref(), Some("founder"));
        assert_eq!(
            snap.original_purchase_id.as_deref(),
            Some("merge-cosmetic-001")
        );

        let reloaded = load_license_snapshot_at(&path, now_fixed());
        assert_eq!(reloaded.cosmetic.as_ref(), Some(&custom_cosmetic));
        assert_eq!(reloaded.status, LicenseStatus::Licensed);

        let on_disk = fs::read_to_string(&path).unwrap();
        let card = parse_and_verify_poc(&on_disk).unwrap();
        assert_eq!(card.cosmetic, custom_cosmetic);
        assert_eq!(card.grants[0], permanent);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn update_cosmetic_preserves_grants() {
        let key = signing_key_from_bytes(POC_PRIVATE_KEY).unwrap();
        let card = mint_spcard(
            &key,
            "spiral",
            LicenseSku::Standard,
            "cosmetic-update-001",
            LicenseChannel::Direct,
            "2026-07-01T12:00:00Z",
            None,
        )
        .unwrap();
        let grants_before = card.grants.clone();

        let dir = temp_dir();
        let path = dir.join("registration.spcard");
        write_registration_card_atomic(&path, &card).unwrap();

        let next = Cosmetic {
            font_id: "mono-01".to_string(),
            color_hex: "#AABBCC".to_string(),
            cardholder_name: String::new(),
            wrap_ref: "default".to_string(),
            wrap_data: None,
        };
        let snap = update_registration_cosmetic_at(&path, next, now_fixed()).unwrap();
        assert_eq!(snap.status, LicenseStatus::Licensed);
        assert_eq!(
            snap.cosmetic.as_ref().map(|c| c.color_hex.as_str()),
            Some("#aabbcc")
        );

        let on_disk = fs::read_to_string(&path).unwrap();
        let reloaded = parse_and_verify_poc(&on_disk).unwrap();
        assert_eq!(reloaded.grants, grants_before);
        assert_eq!(reloaded.cosmetic.color_hex, "#aabbcc");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn update_cosmetic_rejects_missing_card() {
        let dir = temp_dir();
        let path = dir.join("registration.spcard");
        let err = update_registration_cosmetic_at(
            &path,
            Cosmetic {
                font_id: "mono-01".to_string(),
                color_hex: "#112233".to_string(),
                cardholder_name: String::new(),
                wrap_ref: "default".to_string(),
                wrap_data: None,
            },
            now_fixed(),
        )
        .unwrap_err();
        assert!(err.contains("no registration card"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn custom_wrap_survives_round_trip_and_preserves_grants() {
        use image::{DynamicImage, ImageFormat, RgbaImage};
        use std::io::Cursor;

        let key = signing_key_from_bytes(POC_PRIVATE_KEY).unwrap();
        let card = mint_spcard(
            &key,
            "spiral",
            LicenseSku::Standard,
            "wrap-roundtrip-001",
            LicenseChannel::Direct,
            "2026-07-01T12:00:00Z",
            None,
        )
        .unwrap();
        let grants_before = card.grants.clone();

        let dir = temp_dir();
        let path = dir.join("registration.spcard");
        write_registration_card_atomic(&path, &card).unwrap();

        let img = RgbaImage::from_pixel(128, 80, image::Rgba([200, 40, 40, 255]));
        let mut buf = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(img)
            .write_to(&mut buf, ImageFormat::Png)
            .unwrap();
        let snap =
            set_registration_wrap_from_bytes_at(&path, &buf.into_inner(), now_fixed()).unwrap();
        assert_eq!(snap.cosmetic.as_ref().unwrap().wrap_ref, "custom");
        assert!(snap.cosmetic.as_ref().unwrap().wrap_data.is_some());

        let on_disk = fs::read_to_string(&path).unwrap();
        let reloaded = parse_and_verify_poc(&on_disk).unwrap();
        assert_eq!(reloaded.grants, grants_before);
        assert_eq!(reloaded.cosmetic.wrap_ref, "custom");
        assert!(reloaded.cosmetic.wrap_data.is_some());

        let snap2 = load_license_snapshot_at(&path, now_fixed());
        assert_eq!(snap2.status, LicenseStatus::Licensed);
        assert_eq!(snap2.cosmetic.as_ref().unwrap().wrap_ref, "custom");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn merge_rejects_purchase_id_mismatch() {
        let key = signing_key_from_bytes(POC_PRIVATE_KEY).unwrap();
        let card = mint_spcard(
            &key,
            "spiral",
            LicenseSku::Standard,
            "installed-id",
            LicenseChannel::Direct,
            "2026-07-01T12:00:00Z",
            Some("2026-07-15T12:00:00Z".into()),
        )
        .unwrap();
        let dir = temp_dir();
        let path = dir.join("registration.spcard");
        write_registration_card_atomic(&path, &card).unwrap();

        let other = mint_grant(
            &key,
            "spiral",
            LicenseSku::Standard,
            "other-id",
            LicenseChannel::Direct,
            "2026-07-20T12:00:00Z",
            None,
        )
        .unwrap();
        let err = merge_finalized_grant_at(&path, other, now_fixed()).unwrap_err();
        assert!(err.contains("purchase id mismatch"));
        let _ = fs::remove_dir_all(&dir);
    }
}
