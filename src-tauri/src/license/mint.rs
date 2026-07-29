//! Direct-channel mint stub (Phase 4–5) — provisional mint + finalize.
//!
//! Holds signer-side logic: provisional mint, finalize to permanent
//! grant, and idempotent grant storage. Channel proof checks live in
//! [`super::verifier`] (`ProofOfPurchaseVerifier`). The PoC private key is
//! loaded by the CLI from `docs/license/poc-keys/` — never bundled into the app.

use super::{
    default_cosmetic, err, mint_grant, parse_channel, parse_sku, serialize_spcard, Grant,
    LicenseChannel, LicenseError, LicenseSku, Spcard, SPCARD_MANIFEST_VERSION,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::crypto::{signing_key_from_bytes, SigningKey};
use super::verifier::VerifiedPurchase;

/// Default Direct refund window (calendar days).
pub const DEFAULT_REFUND_WINDOW_DAYS: u32 = 14;

/// Extra grace after the refund window before `expiresAt` (clock skew / dogfood).
pub const DEFAULT_EXPIRY_BUFFER_MINUTES: u32 = 5;

/// PoC refunded-purchase stub: purchase ids with this prefix fail finalize.
pub const POC_REFUNDED_PURCHASE_ID_PREFIX: &str = "poc-refunded-";

fn format_license_timestamp(dt: DateTime<Utc>) -> String {
    dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn spcard_with_default_cosmetic(grant: Grant) -> Spcard {
    Spcard {
        manifest_version: SPCARD_MANIFEST_VERSION,
        grants: vec![grant],
        cosmetic: default_cosmetic(),
    }
}

/// Inputs for provisional mint (after proof verification).
#[derive(Debug, Clone)]
pub struct MintProvisionalParams {
    pub product_id: String,
    pub sku: LicenseSku,
    pub original_purchase_id: String,
    pub channel: LicenseChannel,
    pub refund_window: Duration,
    pub buffer: Duration,
}

impl MintProvisionalParams {
    pub fn from_verified(
        purchase: &VerifiedPurchase,
        refund_window_days: u32,
        buffer_minutes: u32,
    ) -> Self {
        Self {
            product_id: purchase.product_id.clone(),
            sku: purchase.sku,
            original_purchase_id: purchase.original_purchase_id.clone(),
            channel: purchase.channel,
            refund_window: Duration::days(i64::from(refund_window_days)),
            buffer: Duration::minutes(i64::from(buffer_minutes)),
        }
    }
}

/// On-disk idempotency store: one grant per `originalPurchaseId`.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MintStoreFile {
    grants: BTreeMap<String, GrantRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrantRecord {
    product_id: String,
    sku: String,
    original_purchase_id: String,
    channel: String,
    issued_at: String,
    expires_at: Option<String>,
    signature: String,
}

impl GrantRecord {
    fn from_grant(g: &Grant) -> Self {
        Self {
            product_id: g.product_id.clone(),
            sku: g.sku.as_str().to_string(),
            original_purchase_id: g.original_purchase_id.clone(),
            channel: g.channel.as_str().to_string(),
            issued_at: g.issued_at.clone(),
            expires_at: g.expires_at.clone(),
            signature: g.signature.clone(),
        }
    }

    fn into_grant(self) -> Result<Grant, LicenseError> {
        Ok(Grant {
            product_id: self.product_id,
            sku: parse_sku(&self.sku)?,
            original_purchase_id: self.original_purchase_id,
            channel: parse_channel(&self.channel)?,
            issued_at: self.issued_at,
            expires_at: self.expires_at,
            signature: self.signature,
        })
    }
}

/// Persistent grant ledger for mint idempotency.
#[derive(Debug)]
pub struct MintStore {
    path: PathBuf,
    file: MintStoreFile,
}

impl MintStore {
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Load an existing store, or start empty if the file is missing.
    pub fn load(path: impl Into<PathBuf>) -> Result<Self, LicenseError> {
        let path = path.into();
        if !path.exists() {
            return Ok(Self {
                path,
                file: MintStoreFile::default(),
            });
        }
        let raw = fs::read_to_string(&path).map_err(|e| {
            err(
                "store_io",
                format!("failed to read mint store {}: {e}", path.display()),
            )
        })?;
        let file: MintStoreFile = serde_json::from_str(&raw).map_err(|e| {
            err(
                "invalid_store",
                format!("mint store is not valid JSON: {e}"),
            )
        })?;
        Ok(Self { path, file })
    }

    pub fn get(&self, original_purchase_id: &str) -> Result<Option<Grant>, LicenseError> {
        match self.file.grants.get(original_purchase_id) {
            Some(rec) => Ok(Some(rec.clone().into_grant()?)),
            None => Ok(None),
        }
    }

    fn put(&mut self, grant: &Grant) {
        self.file.grants.insert(
            grant.original_purchase_id.clone(),
            GrantRecord::from_grant(grant),
        );
    }

    pub fn save(&self) -> Result<(), LicenseError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                err(
                    "store_io",
                    format!("failed to create mint store dir {}: {e}", parent.display()),
                )
            })?;
        }
        let json = serde_json::to_string_pretty(&self.file).map_err(|e| {
            err(
                "serialize_failed",
                format!("failed to serialize mint store: {e}"),
            )
        })?;
        let tmp = {
            let mut tmp = self.path.as_os_str().to_owned();
            tmp.push(".tmp");
            PathBuf::from(tmp)
        };
        fs::write(&tmp, format!("{json}\n")).map_err(|e| {
            err(
                "store_io",
                format!("failed to write mint store temp {}: {e}", tmp.display()),
            )
        })?;
        fs::rename(&tmp, &self.path).map_err(|e| {
            err(
                "store_io",
                format!("failed to commit mint store {}: {e}", self.path.display()),
            )
        })?;
        Ok(())
    }
}

/// Outcome of [`mint_provisional`].
#[derive(Debug, Clone)]
pub struct MintProvisionalResult {
    pub card: Spcard,
    /// True when an existing grant was returned (idempotent remint).
    pub reused: bool,
}

/// Mint a provisional `.spcard` with default cosmetic.
///
/// Same `originalPurchaseId` returns the **same** stored grant (no second
/// logical grant). Fresh mints set
/// `expiresAt = now + refundWindow + buffer`.
pub fn mint_provisional(
    signing_key: &SigningKey,
    store: &mut MintStore,
    params: &MintProvisionalParams,
    now: DateTime<Utc>,
) -> Result<MintProvisionalResult, LicenseError> {
    if let Some(existing) = store.get(&params.original_purchase_id)? {
        return Ok(MintProvisionalResult {
            card: spcard_with_default_cosmetic(existing),
            reused: true,
        });
    }

    let issued_at = format_license_timestamp(now);
    let expires_at = format_license_timestamp(now + params.refund_window + params.buffer);

    let grant = mint_grant(
        signing_key,
        params.product_id.clone(),
        params.sku,
        params.original_purchase_id.clone(),
        params.channel,
        issued_at,
        Some(expires_at),
    )?;

    store.put(&grant);
    store.save()?;

    Ok(MintProvisionalResult {
        card: spcard_with_default_cosmetic(grant),
        reused: false,
    })
}

/// Outcome of [`finalize`].
#[derive(Debug, Clone)]
pub struct FinalizeResult {
    /// Permanent grant only (`expiresAt: null`) — never a full `.spcard`.
    pub grant: Grant,
    /// True when an existing permanent grant was returned (idempotent).
    pub reused: bool,
}

/// Convert a stored provisional grant into a permanent grant.
///
/// - Unknown `originalPurchaseId` → `unknown_purchase`
/// - Ids starting with [`POC_REFUNDED_PURCHASE_ID_PREFIX`] → `refunded`
/// - Already permanent (`expiresAt: null`) → same grant, `reused: true`
/// - Otherwise mint a fresh permanent grant (preserving productId + sku) and overwrite
pub fn finalize(
    signing_key: &SigningKey,
    store: &mut MintStore,
    original_purchase_id: &str,
    now: DateTime<Utc>,
) -> Result<FinalizeResult, LicenseError> {
    let original_purchase_id = original_purchase_id.trim();
    if original_purchase_id.is_empty() {
        return Err(err(
            "invalid_purchase_id",
            "originalPurchaseId must be non-empty",
        ));
    }
    if original_purchase_id.starts_with(POC_REFUNDED_PURCHASE_ID_PREFIX) {
        return Err(err(
            "refunded",
            "Purchase was refunded; permanent registration cannot be issued",
        ));
    }

    let Some(existing) = store.get(original_purchase_id)? else {
        return Err(err(
            "unknown_purchase",
            format!("No provisional grant for purchase id {original_purchase_id}"),
        ));
    };

    if existing.expires_at.is_none() {
        return Ok(FinalizeResult {
            grant: existing,
            reused: true,
        });
    }

    let issued_at = format_license_timestamp(now);
    let grant = mint_grant(
        signing_key,
        existing.product_id,
        existing.sku,
        existing.original_purchase_id,
        existing.channel,
        issued_at,
        None,
    )?;

    store.put(&grant);
    store.save()?;

    Ok(FinalizeResult {
        grant,
        reused: false,
    })
}

/// Load a 32-byte Ed25519 private seed from disk.
pub fn load_signing_key(path: &Path) -> Result<SigningKey, LicenseError> {
    let bytes = fs::read(path).map_err(|e| {
        err(
            "invalid_private_key",
            format!("failed to read private key {}: {e}", path.display()),
        )
    })?;
    signing_key_from_bytes(&bytes)
}

/// Write a `.spcard` JSON file (pretty), creating parent dirs as needed.
pub fn write_spcard_file(path: &Path, card: &Spcard) -> Result<(), LicenseError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| {
                err(
                    "store_io",
                    format!("failed to create output dir {}: {e}", parent.display()),
                )
            })?;
        }
    }
    let json = serialize_spcard(card)?;
    fs::write(path, format!("{json}\n")).map_err(|e| {
        err(
            "store_io",
            format!("failed to write {}: {e}", path.display()),
        )
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::license::{
        parse_and_verify, signing_key_from_bytes, verifying_key_from_bytes, verify_grant_signature,
        POC_PUBLIC_KEY_BYTES, PRODUCT_ID_SPIRAL,
    };
    use std::sync::atomic::{AtomicU64, Ordering};

    const POC_PRIVATE_KEY: &[u8; 32] =
        include_bytes!("../../../docs/license/poc-keys/ed25519-private.raw");

    static TEST_STORE_SEQ: AtomicU64 = AtomicU64::new(0);

    fn signing_key() -> SigningKey {
        signing_key_from_bytes(POC_PRIVATE_KEY).unwrap()
    }

    fn verifying_key() -> crate::license::VerifyingKey {
        verifying_key_from_bytes(POC_PUBLIC_KEY_BYTES).unwrap()
    }

    fn with_store<F: FnOnce(&mut MintStore, &Path)>(f: F) {
        let seq = TEST_STORE_SEQ.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "spiral-mint-test-{}-{}",
            std::process::id(),
            seq
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("grants.json");
        let mut store = MintStore::load(&path).unwrap();
        f(&mut store, &path);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn mint_provisional_signs_and_sets_expiry() {
        with_store(|store, _| {
            let now = DateTime::parse_from_rfc3339("2026-07-25T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc);
            let params = MintProvisionalParams {
                product_id: PRODUCT_ID_SPIRAL.into(),
                sku: LicenseSku::Standard,
                original_purchase_id: "mint-test-001".into(),
                channel: LicenseChannel::Direct,
                refund_window: Duration::days(14),
                buffer: Duration::minutes(5),
            };
            let result = mint_provisional(&signing_key(), store, &params, now).unwrap();
            assert!(!result.reused);
            assert_eq!(
                result.card.grants[0].expires_at.as_deref(),
                Some("2026-08-08T12:05:00Z")
            );
            assert_eq!(result.card.cosmetic, default_cosmetic());
            parse_and_verify(&serialize_spcard(&result.card).unwrap(), &verifying_key()).unwrap();
        });
    }

    #[test]
    fn remint_same_purchase_id_is_idempotent() {
        with_store(|store, path| {
            let now = DateTime::parse_from_rfc3339("2026-07-25T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc);
            let params = MintProvisionalParams {
                product_id: PRODUCT_ID_SPIRAL.into(),
                sku: LicenseSku::Founder,
                original_purchase_id: "mint-idem-001".into(),
                channel: LicenseChannel::Direct,
                refund_window: Duration::days(14),
                buffer: Duration::minutes(5),
            };
            let first = mint_provisional(&signing_key(), store, &params, now).unwrap();
            assert!(!first.reused);
            assert_eq!(first.card.grants[0].sku, LicenseSku::Founder);

            let later = now + Duration::hours(3);
            let second = mint_provisional(&signing_key(), store, &params, later).unwrap();
            assert!(second.reused);
            assert_eq!(first.card.grants, second.card.grants);

            let mut reloaded = MintStore::load(path).unwrap();
            let third = mint_provisional(&signing_key(), &mut reloaded, &params, later).unwrap();
            assert!(third.reused);
            assert_eq!(first.card.grants, third.card.grants);
        });
    }

    fn provisional_params(purchase_id: &str) -> MintProvisionalParams {
        MintProvisionalParams {
            product_id: PRODUCT_ID_SPIRAL.into(),
            sku: LicenseSku::Standard,
            original_purchase_id: purchase_id.into(),
            channel: LicenseChannel::Direct,
            refund_window: Duration::days(14),
            buffer: Duration::minutes(5),
        }
    }

    #[test]
    fn finalize_unknown_purchase_fails() {
        with_store(|store, _| {
            let now = DateTime::parse_from_rfc3339("2026-07-25T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc);
            let err = finalize(&signing_key(), store, "missing-id", now).unwrap_err();
            assert_eq!(err.code, "unknown_purchase");
        });
    }

    #[test]
    fn finalize_refunded_prefix_fails() {
        with_store(|store, _| {
            let now = DateTime::parse_from_rfc3339("2026-07-25T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc);
            let params = provisional_params("poc-refunded-001");
            mint_provisional(&signing_key(), store, &params, now).unwrap();
            let err = finalize(&signing_key(), store, "poc-refunded-001", now).unwrap_err();
            assert_eq!(err.code, "refunded");
        });
    }

    #[test]
    fn finalize_issues_permanent_grant_preserving_sku() {
        with_store(|store, _| {
            let now = DateTime::parse_from_rfc3339("2026-07-25T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc);
            let mut params = provisional_params("finalize-test-001");
            params.sku = LicenseSku::Founder;
            let provisional = mint_provisional(&signing_key(), store, &params, now).unwrap();
            assert!(provisional.card.grants[0].expires_at.is_some());

            let later = now + Duration::days(20);
            let result = finalize(&signing_key(), store, "finalize-test-001", later).unwrap();
            assert!(!result.reused);
            assert!(result.grant.expires_at.is_none());
            assert_eq!(result.grant.sku, LicenseSku::Founder);
            assert_eq!(
                result.grant.original_purchase_id,
                provisional.card.grants[0].original_purchase_id
            );
            assert_ne!(
                result.grant.signature,
                provisional.card.grants[0].signature
            );
            assert_eq!(result.grant.issued_at, "2026-08-14T12:00:00Z");
            verify_grant_signature(&result.grant, &verifying_key()).unwrap();
        });
    }

    #[test]
    fn finalize_is_idempotent() {
        with_store(|store, path| {
            let now = DateTime::parse_from_rfc3339("2026-07-25T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc);
            let params = provisional_params("finalize-idem-001");
            mint_provisional(&signing_key(), store, &params, now).unwrap();

            let first = finalize(&signing_key(), store, "finalize-idem-001", now).unwrap();
            assert!(!first.reused);

            let later = now + Duration::hours(5);
            let second = finalize(&signing_key(), store, "finalize-idem-001", later).unwrap();
            assert!(second.reused);
            assert_eq!(first.grant, second.grant);

            let mut reloaded = MintStore::load(path).unwrap();
            let third = finalize(&signing_key(), &mut reloaded, "finalize-idem-001", later).unwrap();
            assert!(third.reused);
            assert_eq!(first.grant, third.grant);
        });
    }
}
