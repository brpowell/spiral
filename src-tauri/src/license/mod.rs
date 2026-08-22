//! `.spcard` grant library — parse, sign, verify + app license state.
//!
//! Contract: `docs/license/spcard-v1.md`. Each grant is independently signed
//! over a fixed field concatenation; cosmetic is never signed.
//!
//! Channel adapters ([`verifier::ProofOfPurchaseVerifier`]) are **signer-side**
//! only — see `docs/license/channel-adapter.md`. Offline unlock never calls them.

mod crypto;
pub mod mint;
mod runtime;
mod trial_gate;
pub mod verifier;
mod wrap;

pub use crypto::{
    sign_grant, signing_key_from_bytes, verify_grant_signature, verifying_key_from_bytes,
    SigningKey, VerifyingKey,
};
pub use runtime::{
    clear_registration_wrap, install_registration_card, load_license_snapshot,
    merge_finalized_grant_json, registration_spcard_path_if_present,
    set_registration_wrap_from_bytes, update_registration_cosmetic, LicenseSnapshot, LicenseStatus,
};
pub use trial_gate::assert_can_add_library_track;
pub use verifier::{
    DirectMintProof, DirectProofVerifier, FlatpakProof, FlatpakProofVerifier, MacAppStoreProof,
    MacAppStoreProofVerifier, ProofOfPurchaseVerifier, SteamOwnershipProof, SteamProofVerifier,
    VerifiedPurchase, WindowsStoreProof, WindowsStoreProofVerifier, POC_DIRECT_MINT_GRANT,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Current `.spcard` schema version (`manifestVersion`).
pub const SPCARD_MANIFEST_VERSION: u32 = 1;

/// Free-trial library track cap until a verified card unlocks (PoC).
pub const TRIAL_LIBRARY_TRACK_CAP: u32 = 24;

/// PoC product id (unlock identity).
pub const PRODUCT_ID_SPIRAL: &str = "spiral";

/// Default commercial / cohort SKU.
pub const SKU_STANDARD: &str = "standard";

/// Early-access founder cohort SKU.
pub const SKU_FOUNDER: &str = "founder";

/// U+001F UNIT SEPARATOR between signed grant fields.
const FIELD_SEP: u8 = 0x1F;

/// Bundled PoC Ed25519 public key (32 raw bytes).
pub const POC_PUBLIC_KEY_BYTES: &[u8; 32] = include_bytes!("../../keys/license/poc-ed25519.pub");

/// Max Unicode scalar values for `cardholderName` (Studio write + repair).
const CARDHOLDER_NAME_MAX_CHARS: usize = 40;

/// Default cosmetic used on mint and soft-fail repair.
pub fn default_cosmetic() -> Cosmetic {
    Cosmetic {
        font_id: "mono-01".to_string(),
        color_hex: "#2b2b2b".to_string(),
        cardholder_name: String::new(),
        wrap_ref: "default".to_string(),
        wrap_data: None,
    }
}

/// PoC bundled font ids. Unknown → default `mono-01`.
const KNOWN_FONT_IDS: &[&str] = &["mono-01"];

/// PoC wrap preset ids (plus `"custom"`).
const KNOWN_WRAP_PRESETS: &[&str] = &["default"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Spcard {
    pub manifest_version: u32,
    pub grants: Vec<Grant>,
    pub cosmetic: Cosmetic,
}

/// Commercial / cohort variant of a product grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseSku {
    Standard,
    Founder,
}

impl LicenseSku {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Standard => SKU_STANDARD,
            Self::Founder => SKU_FOUNDER,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub product_id: String,
    pub sku: LicenseSku,
    pub original_purchase_id: String,
    pub channel: LicenseChannel,
    pub issued_at: String,
    /// Provisional: RFC 3339 UTC; permanent: JSON `null`.
    pub expires_at: Option<String>,
    /// Standard Base64 of 64-byte Ed25519 signature.
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cosmetic {
    pub font_id: String,
    pub color_hex: String,
    pub cardholder_name: String,
    pub wrap_ref: String,
    pub wrap_data: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseChannel {
    Direct,
    Steam,
    MacAppStore,
    WindowsStore,
    Flatpak,
}

impl LicenseChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Steam => "steam",
            Self::MacAppStore => "mac_app_store",
            Self::WindowsStore => "windows_store",
            Self::Flatpak => "flatpak",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LicenseError {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for LicenseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for LicenseError {}

fn err(code: &'static str, message: impl Into<String>) -> LicenseError {
    LicenseError {
        code,
        message: message.into(),
    }
}

/// Fixed ordered concat of grant fields for Ed25519 (excludes `signature`).
pub fn grant_signing_bytes(grant: &Grant) -> Vec<u8> {
    join_signing_fields([
        grant.product_id.as_str(),
        grant.sku.as_str(),
        grant.original_purchase_id.as_str(),
        grant.channel.as_str(),
        grant.issued_at.as_str(),
        grant.expires_at.as_deref().unwrap_or(""),
    ])
}

fn join_signing_fields(parts: [&str; 6]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, part) in parts.iter().enumerate() {
        if i > 0 {
            out.push(FIELD_SEP);
        }
        out.extend_from_slice(part.as_bytes());
    }
    out
}

/// First grant unlocking the Spiral product, if any.
pub fn spiral_grant(card: &Spcard) -> Option<&Grant> {
    card.grants
        .iter()
        .find(|g| g.product_id == PRODUCT_ID_SPIRAL)
}

/// RFC 3339 UTC second precision with literal `Z` (`YYYY-MM-DDTHH:MM:SSZ`).
pub fn is_valid_timestamp(s: &str) -> bool {
    if s.len() != 20 {
        return false;
    }
    let b = s.as_bytes();
    // YYYY-MM-DDTHH:MM:SSZ
    if b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'Z'
    {
        return false;
    }
    b[..4].iter().all(u8::is_ascii_digit)
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[8..10].iter().all(u8::is_ascii_digit)
        && b[11..13].iter().all(u8::is_ascii_digit)
        && b[14..16].iter().all(u8::is_ascii_digit)
        && b[17..19].iter().all(u8::is_ascii_digit)
}

fn is_strict_color_hex(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 7 || b[0] != b'#' {
        return false;
    }
    b[1..].iter().all(|c| c.is_ascii_hexdigit())
}

/// Soft-repair cosmetic to defaults / normalized fields. Never fails.
pub fn repair_cosmetic(raw: Option<&Value>) -> Cosmetic {
    let Some(obj) = raw.and_then(|v| v.as_object()) else {
        return default_cosmetic();
    };

    let mut cosmetic = default_cosmetic();

    if let Some(font) = obj.get("fontId").and_then(|v| v.as_str()) {
        if KNOWN_FONT_IDS.contains(&font) {
            cosmetic.font_id = font.to_string();
        }
    }

    if let Some(color) = obj.get("colorHex").and_then(|v| v.as_str()) {
        if is_strict_color_hex(color) {
            cosmetic.color_hex = format!("#{}", color[1..].to_ascii_lowercase());
        }
    }

    if let Some(name) = obj.get("cardholderName").and_then(|v| v.as_str()) {
        cosmetic.cardholder_name = normalize_cardholder_name(name);
    }

    let wrap_ref = obj
        .get("wrapRef")
        .and_then(|v| v.as_str())
        .unwrap_or("default");

    if wrap_ref == "custom" {
        match obj.get("wrapData").and_then(|v| v.as_str()) {
            // On load: validate decode + caps; pass through when already sanitized.
            // Full re-encode happens on Studio write / set (see prepare_cosmetic_for_write).
            Some(data) if !data.is_empty() => {
                if let Some(accepted) = wrap::try_accept_wrap_base64_for_load(data) {
                    cosmetic.wrap_ref = "custom".to_string();
                    cosmetic.wrap_data = Some(accepted);
                }
            }
            _ => {}
        }
    } else if KNOWN_WRAP_PRESETS.contains(&wrap_ref) {
        cosmetic.wrap_ref = wrap_ref.to_string();
        cosmetic.wrap_data = None;
    }

    cosmetic
}

/// Trim + cap cardholder display name (cosmetic only).
fn normalize_cardholder_name(name: &str) -> String {
    let trimmed: String = name
        .trim()
        .chars()
        .take(CARDHOLDER_NAME_MAX_CHARS)
        .collect();
    trimmed
}

/// Normalize cosmetic for write (Studio). Custom wraps are re-encoded once; failures error.
pub fn prepare_cosmetic_for_write(cosmetic: Cosmetic) -> Result<Cosmetic, LicenseError> {
    // Normalize font / color / name without the load-path wrap accept (we'd re-encode next).
    let mut repaired = {
        let mut value = serde_json::to_value(&Cosmetic {
            font_id: cosmetic.font_id.clone(),
            color_hex: cosmetic.color_hex.clone(),
            cardholder_name: cosmetic.cardholder_name.clone(),
            wrap_ref: "default".to_string(),
            wrap_data: None,
        })
        .map_err(|e| {
            err(
                "invalid_cosmetic",
                format!("failed to encode cosmetic: {e}"),
            )
        })?;
        // Preserve requested wrap ref for the branch below; repair only non-wrap fields.
        if let Some(obj) = value.as_object_mut() {
            obj.insert(
                "wrapRef".into(),
                serde_json::Value::String(cosmetic.wrap_ref.clone()),
            );
        }
        repair_cosmetic(Some(&value))
    };

    if cosmetic.wrap_ref == "custom" {
        let Some(data) = cosmetic.wrap_data.as_deref().filter(|s| !s.is_empty()) else {
            return Err(err("invalid_wrap", "custom wrap requires wrapData"));
        };
        let sanitized = wrap::sanitize_wrap_base64(data)?;
        repaired.wrap_ref = "custom".to_string();
        repaired.wrap_data = Some(sanitized);
    } else {
        repaired.wrap_ref = if KNOWN_WRAP_PRESETS.contains(&cosmetic.wrap_ref.as_str()) {
            cosmetic.wrap_ref.clone()
        } else {
            "default".to_string()
        };
        repaired.wrap_data = None;
    }

    Ok(repaired)
}

pub(crate) fn parse_channel(s: &str) -> Result<LicenseChannel, LicenseError> {
    match s {
        "direct" => Ok(LicenseChannel::Direct),
        "steam" => Ok(LicenseChannel::Steam),
        "mac_app_store" => Ok(LicenseChannel::MacAppStore),
        "windows_store" => Ok(LicenseChannel::WindowsStore),
        "flatpak" => Ok(LicenseChannel::Flatpak),
        other => Err(err(
            "unsupported_channel",
            format!("unsupported channel: {other}"),
        )),
    }
}

pub(crate) fn parse_sku(s: &str) -> Result<LicenseSku, LicenseError> {
    match s {
        SKU_STANDARD => Ok(LicenseSku::Standard),
        SKU_FOUNDER => Ok(LicenseSku::Founder),
        other => Err(err("unsupported_sku", format!("unsupported sku: {other}"))),
    }
}

fn require_nonempty_str(
    obj: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<String, LicenseError> {
    match obj.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Ok(s.clone()),
        Some(Value::String(_)) => Err(err(
            "invalid_grant",
            format!("grant.{key} must be non-empty"),
        )),
        Some(_) => Err(err(
            "invalid_grant",
            format!("grant.{key} must be a string"),
        )),
        None => Err(err("invalid_grant", format!("grant missing {key}"))),
    }
}

fn parse_grant(value: &Value) -> Result<Grant, LicenseError> {
    let obj = value
        .as_object()
        .ok_or_else(|| err("invalid_grant", "grant must be an object"))?;

    let product_id = require_nonempty_str(obj, "productId")?;
    let sku_str = require_nonempty_str(obj, "sku")?;
    let sku = parse_sku(&sku_str)?;
    let original_purchase_id = require_nonempty_str(obj, "originalPurchaseId")?;
    let channel_str = require_nonempty_str(obj, "channel")?;
    let channel = parse_channel(&channel_str)?;
    let issued_at = require_nonempty_str(obj, "issuedAt")?;
    if !is_valid_timestamp(&issued_at) {
        return Err(err(
            "invalid_timestamp",
            format!("issuedAt must be YYYY-MM-DDTHH:MM:SSZ, got {issued_at}"),
        ));
    }

    let expires_at = match obj.get("expiresAt") {
        None => return Err(err("invalid_grant", "grant missing expiresAt")),
        Some(Value::Null) => None,
        Some(Value::String(s)) => {
            if !is_valid_timestamp(s) {
                return Err(err(
                    "invalid_timestamp",
                    format!("expiresAt must be YYYY-MM-DDTHH:MM:SSZ or null, got {s}"),
                ));
            }
            Some(s.clone())
        }
        Some(_) => return Err(err("invalid_grant", "expiresAt must be a string or null")),
    };

    let signature = require_nonempty_str(obj, "signature")?;

    Ok(Grant {
        product_id,
        sku,
        original_purchase_id,
        channel,
        issued_at,
        expires_at,
        signature,
    })
}

/// Parse `.spcard` JSON. Unknown `manifestVersion` fails closed.
/// Missing/corrupt `cosmetic` is repaired to defaults (does not fail).
pub fn parse_spcard(json: &str) -> Result<Spcard, LicenseError> {
    let value: Value = serde_json::from_str(json)
        .map_err(|e| err("invalid_json", format!("invalid .spcard JSON: {e}")))?;

    let obj = value
        .as_object()
        .ok_or_else(|| err("invalid_spcard", ".spcard root must be an object"))?;

    // manifestVersion first
    let manifest_version = match obj.get("manifestVersion") {
        None => {
            return Err(err(
                "missing_manifest_version",
                ".spcard is missing manifestVersion",
            ))
        }
        Some(Value::Number(n)) => n.as_u64().ok_or_else(|| {
            err(
                "unsupported_manifest_version",
                format!("unsupported manifestVersion: {n}"),
            )
        })?,
        Some(other) => {
            return Err(err(
                "unsupported_manifest_version",
                format!("unsupported manifestVersion: {other}"),
            ))
        }
    };
    if manifest_version != u64::from(SPCARD_MANIFEST_VERSION) {
        return Err(err(
            "unsupported_manifest_version",
            format!(
                "unsupported manifestVersion: {manifest_version} (expected {SPCARD_MANIFEST_VERSION})"
            ),
        ));
    }

    // Strict top-level keys
    for key in obj.keys() {
        if key != "manifestVersion" && key != "grants" && key != "cosmetic" {
            return Err(err(
                "unknown_field",
                format!("unknown top-level field: {key}"),
            ));
        }
    }

    let grants_val = obj
        .get("grants")
        .ok_or_else(|| err("invalid_spcard", ".spcard is missing grants"))?;
    let grants_arr = grants_val
        .as_array()
        .ok_or_else(|| err("invalid_spcard", "grants must be an array"))?;
    if grants_arr.is_empty() {
        return Err(err(
            "invalid_spcard",
            "grants must contain at least one grant",
        ));
    }
    let mut grants = Vec::with_capacity(grants_arr.len());
    for (i, item) in grants_arr.iter().enumerate() {
        grants.push(
            parse_grant(item).map_err(|e| err(e.code, format!("grants[{i}]: {}", e.message)))?,
        );
    }

    let cosmetic = repair_cosmetic(obj.get("cosmetic"));

    Ok(Spcard {
        manifest_version: SPCARD_MANIFEST_VERSION,
        grants,
        cosmetic,
    })
}

/// Serialize a card to pretty JSON (stable field order via serde rename).
pub fn serialize_spcard(card: &Spcard) -> Result<String, LicenseError> {
    serde_json::to_string_pretty(card).map_err(|e| {
        err(
            "serialize_failed",
            format!("failed to serialize .spcard: {e}"),
        )
    })
}

/// Serialize a grant object (camelCase) — finalize HTTP / CLI response.
pub fn serialize_grant(grant: &Grant) -> Result<String, LicenseError> {
    serde_json::to_string_pretty(grant).map_err(|e| {
        err(
            "serialize_failed",
            format!("failed to serialize grant: {e}"),
        )
    })
}

/// Parse + verify a standalone grant JSON blob (finalize response).
pub fn parse_and_verify_grant_poc(json: &str) -> Result<Grant, LicenseError> {
    let value: Value = serde_json::from_str(json)
        .map_err(|e| err("invalid_json", format!("grant is not valid JSON: {e}")))?;
    let grant = parse_grant(&value)?;
    let key = verifying_key_from_bytes(POC_PUBLIC_KEY_BYTES)?;
    verify_grant_signature(&grant, &key)?;
    Ok(grant)
}

/// Verify every grant signature with the given public key.
/// Reads **only** grant fields for the signed concat; cosmetic is ignored.
pub fn verify_spcard(card: &Spcard, public_key: &VerifyingKey) -> Result<(), LicenseError> {
    for (i, grant) in card.grants.iter().enumerate() {
        verify_grant_signature(grant, public_key)
            .map_err(|e| err(e.code, format!("grants[{i}]: {}", e.message)))?;
    }
    Ok(())
}

/// Parse + verify in one step. Returns the card (with repaired cosmetic) on success.
pub fn parse_and_verify(json: &str, public_key: &VerifyingKey) -> Result<Spcard, LicenseError> {
    let card = parse_spcard(json)?;
    verify_spcard(&card, public_key)?;
    Ok(card)
}

/// Convenience: verify against the bundled PoC public key.
pub fn parse_and_verify_poc(json: &str) -> Result<Spcard, LicenseError> {
    let key = verifying_key_from_bytes(POC_PUBLIC_KEY_BYTES)?;
    parse_and_verify(json, &key)
}

/// Build a grant and attach a fresh signature (mint / finalize helpers).
pub fn mint_grant(
    signing_key: &SigningKey,
    product_id: impl Into<String>,
    sku: LicenseSku,
    original_purchase_id: impl Into<String>,
    channel: LicenseChannel,
    issued_at: impl Into<String>,
    expires_at: Option<String>,
) -> Result<Grant, LicenseError> {
    let issued_at = issued_at.into();
    if !is_valid_timestamp(&issued_at) {
        return Err(err(
            "invalid_timestamp",
            format!("issuedAt must be YYYY-MM-DDTHH:MM:SSZ, got {issued_at}"),
        ));
    }
    if let Some(ref exp) = expires_at {
        if !is_valid_timestamp(exp) {
            return Err(err(
                "invalid_timestamp",
                format!("expiresAt must be YYYY-MM-DDTHH:MM:SSZ or null, got {exp}"),
            ));
        }
    }

    let mut grant = Grant {
        product_id: product_id.into(),
        sku,
        original_purchase_id: original_purchase_id.into(),
        channel,
        issued_at,
        expires_at,
        signature: String::new(),
    };
    if grant.product_id.is_empty() || grant.original_purchase_id.is_empty() {
        return Err(err(
            "invalid_grant",
            "productId and originalPurchaseId must be non-empty",
        ));
    }
    grant.signature = sign_grant(signing_key, &grant)?;
    Ok(grant)
}

/// Mint a full provisional/permanent `.spcard` with default cosmetic (one grant).
pub fn mint_spcard(
    signing_key: &SigningKey,
    product_id: impl Into<String>,
    sku: LicenseSku,
    original_purchase_id: impl Into<String>,
    channel: LicenseChannel,
    issued_at: impl Into<String>,
    expires_at: Option<String>,
) -> Result<Spcard, LicenseError> {
    Ok(Spcard {
        manifest_version: SPCARD_MANIFEST_VERSION,
        grants: vec![mint_grant(
            signing_key,
            product_id,
            sku,
            original_purchase_id,
            channel,
            issued_at,
            expires_at,
        )?],
        cosmetic: default_cosmetic(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

    const PROVISIONAL: &str = include_str!("../../../docs/license/examples/provisional.spcard");
    const PERMANENT: &str = include_str!("../../../docs/license/examples/permanent.spcard");
    const POC_PRIVATE_KEY: &[u8; 32] =
        include_bytes!("../../../docs/license/poc-keys/ed25519-private.raw");

    fn poc_verifying_key() -> VerifyingKey {
        verifying_key_from_bytes(POC_PUBLIC_KEY_BYTES).expect("poc public key")
    }

    fn poc_signing_key() -> SigningKey {
        signing_key_from_bytes(POC_PRIVATE_KEY).expect("poc private key")
    }

    #[test]
    fn provisional_fixture_verifies() {
        assert_eq!(TRIAL_LIBRARY_TRACK_CAP, 24);
        assert_eq!(PRODUCT_ID_SPIRAL, "spiral");
        let card = parse_and_verify(PROVISIONAL, &poc_verifying_key()).unwrap();
        assert_eq!(card.manifest_version, 1);
        assert_eq!(card.grants.len(), 1);
        let grant = &card.grants[0];
        assert_eq!(grant.product_id, PRODUCT_ID_SPIRAL);
        assert_eq!(grant.sku, LicenseSku::Standard);
        assert_eq!(grant.channel, LicenseChannel::Direct);
        assert_eq!(grant.expires_at.as_deref(), Some("2026-07-15T12:00:00Z"));
        assert_eq!(card.cosmetic.font_id, "mono-01");
    }

    #[test]
    fn permanent_fixture_verifies() {
        let card = parse_and_verify(PERMANENT, &poc_verifying_key()).unwrap();
        assert!(card.grants[0].expires_at.is_none());
        assert_eq!(card.grants[0].issued_at, "2026-07-15T12:05:00Z");
        assert_eq!(card.grants[0].sku, LicenseSku::Standard);
    }

    #[test]
    fn concat_matches_phase0_provisional_hex() {
        let card = parse_spcard(PROVISIONAL).unwrap();
        let bytes = grant_signing_bytes(&card.grants[0]);
        assert_eq!(
            hex::encode(&bytes),
            "73706972616c1f7374616e646172641f706f632d6469726563742d303030311f6469726563741f323032362d30372d30315431323a30303a30305a1f323032362d30372d31355431323a30303a30305a"
        );
    }

    #[test]
    fn concat_matches_phase0_permanent_hex() {
        let card = parse_spcard(PERMANENT).unwrap();
        let bytes = grant_signing_bytes(&card.grants[0]);
        assert_eq!(
            hex::encode(&bytes),
            "73706972616c1f7374616e646172641f706f632d6469726563742d303030311f6469726563741f323032362d30372d31355431323a30353a30305a1f"
        );
        // Permanent ends with separator (empty expires field)
        assert_eq!(*bytes.last().unwrap(), FIELD_SEP);
    }

    #[test]
    fn flipped_bit_in_signature_fails() {
        let mut card = parse_spcard(PROVISIONAL).unwrap();
        let mut sig = BASE64.decode(&card.grants[0].signature).unwrap();
        sig[0] ^= 0x01;
        card.grants[0].signature = BASE64.encode(&sig);
        let err = verify_spcard(&card, &poc_verifying_key()).unwrap_err();
        assert_eq!(err.code, "invalid_signature");
    }

    #[test]
    fn flipped_bit_in_signed_field_fails() {
        let mut card = parse_spcard(PROVISIONAL).unwrap();
        card.grants[0].product_id = "spirax".to_string();
        let err = verify_spcard(&card, &poc_verifying_key()).unwrap_err();
        assert_eq!(err.code, "invalid_signature");
    }

    #[test]
    fn cosmetic_only_edits_still_verify() {
        let mut value: Value = serde_json::from_str(PROVISIONAL).unwrap();
        value["cosmetic"]["colorHex"] = Value::String("#00ff00".into());
        value["cosmetic"]["fontId"] = Value::String("mono-01".into());
        value["cosmetic"]["wrapRef"] = Value::String("default".into());
        value["cosmetic"]["cardholderName"] = Value::String("Ada".into());
        parse_and_verify(&value.to_string(), &poc_verifying_key()).unwrap();
    }

    #[test]
    fn missing_cosmetic_defaults_and_still_verifies() {
        let mut value: Value = serde_json::from_str(PROVISIONAL).unwrap();
        value.as_object_mut().unwrap().remove("cosmetic");
        let card = parse_and_verify(&value.to_string(), &poc_verifying_key()).unwrap();
        assert_eq!(card.cosmetic, default_cosmetic());
    }

    #[test]
    fn corrupt_cosmetic_defaults_and_still_verifies() {
        let mut value: Value = serde_json::from_str(PERMANENT).unwrap();
        value["cosmetic"] = serde_json::json!({
            "fontId": "not-a-font",
            "colorHex": "red",
            "cardholderName": 123,
            "wrapRef": "nope",
            "wrapData": 123
        });
        let card = parse_and_verify(&value.to_string(), &poc_verifying_key()).unwrap();
        assert_eq!(card.cosmetic, default_cosmetic());
    }

    #[test]
    fn provisional_and_permanent_round_trip() {
        let key = poc_signing_key();
        let verify = key.verifying_key();

        let provisional = mint_spcard(
            &key,
            "spiral",
            LicenseSku::Standard,
            "round-trip-001",
            LicenseChannel::Direct,
            "2026-07-25T12:00:00Z",
            Some("2026-08-08T12:00:00Z".into()),
        )
        .unwrap();
        let json = serialize_spcard(&provisional).unwrap();
        let parsed = parse_and_verify(&json, &verify).unwrap();
        assert_eq!(
            parsed.grants[0].expires_at.as_deref(),
            Some("2026-08-08T12:00:00Z")
        );
        assert_eq!(parsed.cosmetic, default_cosmetic());

        let permanent = mint_spcard(
            &key,
            "spiral",
            LicenseSku::Founder,
            "round-trip-001",
            LicenseChannel::Direct,
            "2026-08-08T12:05:00Z",
            None,
        )
        .unwrap();
        let json = serialize_spcard(&permanent).unwrap();
        let parsed = parse_and_verify(&json, &verify).unwrap();
        assert!(parsed.grants[0].expires_at.is_none());
        assert_eq!(parsed.grants[0].sku, LicenseSku::Founder);
    }

    #[test]
    fn unsupported_manifest_version_fails() {
        let mut value: Value = serde_json::from_str(PROVISIONAL).unwrap();
        value["manifestVersion"] = Value::from(99);
        let err = parse_spcard(&value.to_string()).unwrap_err();
        assert_eq!(err.code, "unsupported_manifest_version");
    }

    #[test]
    fn unknown_channel_fails() {
        let mut value: Value = serde_json::from_str(PROVISIONAL).unwrap();
        value["grants"][0]["channel"] = Value::String("paypal".into());
        let err = parse_spcard(&value.to_string()).unwrap_err();
        assert_eq!(err.code, "unsupported_channel");
    }

    #[test]
    fn unknown_sku_fails() {
        let mut value: Value = serde_json::from_str(PROVISIONAL).unwrap();
        value["grants"][0]["sku"] = Value::String("platinum".into());
        let err = parse_spcard(&value.to_string()).unwrap_err();
        assert_eq!(err.code, "unsupported_sku");
    }

    #[test]
    fn wrong_public_key_fails() {
        let card = parse_spcard(PROVISIONAL).unwrap();
        let other = SigningKey::from_bytes(&[0x42u8; 32]);
        let err = verify_spcard(&card, &other.verifying_key()).unwrap_err();
        assert_eq!(err.code, "invalid_signature");
    }

    #[test]
    fn parse_and_verify_poc_helper() {
        parse_and_verify_poc(PROVISIONAL).unwrap();
        parse_and_verify_poc(PERMANENT).unwrap();
    }
}
