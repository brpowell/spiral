//! Proof-of-purchase channel adapters (signer-side).
//!
//! # Boundary
//!
//! Channels differ **only** in how a purchase is proved before the signer
//! mints or finalizes. Everything else is shared grant core:
//!
//! - `.spcard` schema + Ed25519 field concat ([`docs/license/spcard-v1.md`](../../../../docs/license/spcard-v1.md))
//! - Offline verify + trial gate (this crate’s parse/verify + `trial_gate`)
//! - Provisional → permanent merge (grant-only response; cosmetic preserved)
//!
//! The desktop app never calls these verifiers for day-to-day unlock — it
//! verifies the installed `.spcard` offline with the bundled public key.
//!
//! Architecture context: [license-provisioning-plan.md](../../../../docs/license-provisioning-plan.md)
//! (Distribution Sequencing + Entitlement Core). Adapter inventory:
//! [channel-adapter.md](../../../../docs/license/channel-adapter.md).
//!
//! # PoC inventory
//!
//! | Adapter | Status |
//! | ------- | ------ |
//! | [`DirectProofVerifier`] | Concrete — shared-secret mint grant |
//! | [`SteamProofVerifier`] | Typed stub — always `channel_not_implemented` |
//! | [`MacAppStoreProofVerifier`] | Typed stub |
//! | [`WindowsStoreProofVerifier`] | Typed stub |
//! | [`FlatpakProofVerifier`] | Typed stub |

use super::{err, LicenseChannel, LicenseError, LicenseSku, PRODUCT_ID_SPIRAL};

/// Result after a channel-specific proof is accepted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedPurchase {
    pub product_id: String,
    pub sku: LicenseSku,
    pub original_purchase_id: String,
    pub channel: LicenseChannel,
}

/// Pluggable proof-of-purchase check used by the **signer** before mint.
///
/// A new distribution channel should add a `Proof` type + verifier impl here
/// (and a mint proof path). Do **not** change `.spcard` schema, signature
/// concat, trial gate, or finalize merge rules.
pub trait ProofOfPurchaseVerifier {
    /// Opaque, channel-specific proof presented to the signer.
    type Proof;

    fn channel(&self) -> LicenseChannel;

    /// Validate proof; reject on failure.
    fn verify(&self, proof: &Self::Proof) -> Result<VerifiedPurchase, LicenseError>;
}

// ---------------------------------------------------------------------------
// Direct (concrete PoC implementation)
// ---------------------------------------------------------------------------

/// PoC Direct mint grant (shared secret). CLI / env may override.
pub const POC_DIRECT_MINT_GRANT: &str = "spiral-poc-mint-grant";

/// Opaque Direct mint proof: shared secret + purchase id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectMintProof {
    pub mint_grant: String,
    pub original_purchase_id: String,
    pub product_id: Option<String>,
    /// Commercial / cohort SKU. Defaults to [`LicenseSku::Standard`].
    pub sku: Option<LicenseSku>,
}

/// Direct-channel [`ProofOfPurchaseVerifier`] — the only live adapter in this PoC.
#[derive(Debug, Clone)]
pub struct DirectProofVerifier {
    expected_grant: String,
}

impl DirectProofVerifier {
    pub fn new(expected_grant: impl Into<String>) -> Self {
        Self {
            expected_grant: expected_grant.into(),
        }
    }

    /// PoC default shared secret ([`POC_DIRECT_MINT_GRANT`]).
    pub fn poc() -> Self {
        Self::new(POC_DIRECT_MINT_GRANT)
    }
}

impl ProofOfPurchaseVerifier for DirectProofVerifier {
    type Proof = DirectMintProof;

    fn channel(&self) -> LicenseChannel {
        LicenseChannel::Direct
    }

    fn verify(&self, proof: &DirectMintProof) -> Result<VerifiedPurchase, LicenseError> {
        if proof.mint_grant != self.expected_grant {
            return Err(err(
                "invalid_proof",
                "Direct mint grant rejected (shared secret mismatch)",
            ));
        }
        let original_purchase_id = proof.original_purchase_id.trim();
        if original_purchase_id.is_empty() {
            return Err(err("invalid_proof", "originalPurchaseId must be non-empty"));
        }
        let product_id = proof
            .product_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(PRODUCT_ID_SPIRAL)
            .to_string();
        let sku = proof.sku.unwrap_or(LicenseSku::Standard);

        Ok(VerifiedPurchase {
            product_id,
            sku,
            original_purchase_id: original_purchase_id.to_string(),
            channel: LicenseChannel::Direct,
        })
    }
}

// ---------------------------------------------------------------------------
// Deferred channel stubs (typed only — no live store / Steamworks wiring)
// ---------------------------------------------------------------------------

fn channel_not_implemented(channel: LicenseChannel) -> LicenseError {
    err(
        "channel_not_implemented",
        format!(
            "{} proof verification is not part of the Direct PoC — see docs/license/channel-adapter.md",
            channel.as_str()
        ),
    )
}

/// Steamworks ownership ticket bytes (shape TBD when Steam lands).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SteamOwnershipProof {
    pub ticket: Vec<u8>,
}

/// Typed stub for Steam. Does not call Steamworks in this PoC.
#[derive(Debug, Default, Clone, Copy)]
pub struct SteamProofVerifier;

impl ProofOfPurchaseVerifier for SteamProofVerifier {
    type Proof = SteamOwnershipProof;

    fn channel(&self) -> LicenseChannel {
        LicenseChannel::Steam
    }

    fn verify(&self, _proof: &Self::Proof) -> Result<VerifiedPurchase, LicenseError> {
        Err(channel_not_implemented(LicenseChannel::Steam))
    }
}

/// App Store / StoreKit transaction proof (shape TBD).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MacAppStoreProof {
    pub transaction_jws: String,
}

/// Typed stub for Mac App Store.
#[derive(Debug, Default, Clone, Copy)]
pub struct MacAppStoreProofVerifier;

impl ProofOfPurchaseVerifier for MacAppStoreProofVerifier {
    type Proof = MacAppStoreProof;

    fn channel(&self) -> LicenseChannel {
        LicenseChannel::MacAppStore
    }

    fn verify(&self, _proof: &Self::Proof) -> Result<VerifiedPurchase, LicenseError> {
        Err(channel_not_implemented(LicenseChannel::MacAppStore))
    }
}

/// Microsoft Store transaction proof (shape TBD).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowsStoreProof {
    pub store_id_key: String,
}

/// Typed stub for Windows Store.
#[derive(Debug, Default, Clone, Copy)]
pub struct WindowsStoreProofVerifier;

impl ProofOfPurchaseVerifier for WindowsStoreProofVerifier {
    type Proof = WindowsStoreProof;

    fn channel(&self) -> LicenseChannel {
        LicenseChannel::WindowsStore
    }

    fn verify(&self, _proof: &Self::Proof) -> Result<VerifiedPurchase, LicenseError> {
        Err(channel_not_implemented(LicenseChannel::WindowsStore))
    }
}

/// Flatpak / portal purchase proof (shape TBD with packaging).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlatpakProof {
    pub token: String,
}

/// Typed stub for Flatpak.
#[derive(Debug, Default, Clone, Copy)]
pub struct FlatpakProofVerifier;

impl ProofOfPurchaseVerifier for FlatpakProofVerifier {
    type Proof = FlatpakProof;

    fn channel(&self) -> LicenseChannel {
        LicenseChannel::Flatpak
    }

    fn verify(&self, _proof: &Self::Proof) -> Result<VerifiedPurchase, LicenseError> {
        Err(channel_not_implemented(LicenseChannel::Flatpak))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_proof_accepts_poc_grant() {
        let v = DirectProofVerifier::poc();
        assert_eq!(v.channel(), LicenseChannel::Direct);
        let purchase = v
            .verify(&DirectMintProof {
                mint_grant: POC_DIRECT_MINT_GRANT.into(),
                original_purchase_id: "poc-direct-dev-1".into(),
                product_id: None,
                sku: None,
            })
            .unwrap();
        assert_eq!(purchase.product_id, PRODUCT_ID_SPIRAL);
        assert_eq!(purchase.sku, LicenseSku::Standard);
        assert_eq!(purchase.channel, LicenseChannel::Direct);
        assert_eq!(purchase.original_purchase_id, "poc-direct-dev-1");
    }

    #[test]
    fn direct_proof_rejects_wrong_grant() {
        let v = DirectProofVerifier::poc();
        let err = v
            .verify(&DirectMintProof {
                mint_grant: "nope".into(),
                original_purchase_id: "x".into(),
                product_id: None,
                sku: None,
            })
            .unwrap_err();
        assert_eq!(err.code, "invalid_proof");
    }

    #[test]
    fn deferred_channel_stubs_reject() {
        let cases: &[(&str, Result<VerifiedPurchase, LicenseError>)] = &[
            (
                "steam",
                SteamProofVerifier.verify(&SteamOwnershipProof {
                    ticket: vec![1, 2, 3],
                }),
            ),
            (
                "mac_app_store",
                MacAppStoreProofVerifier.verify(&MacAppStoreProof {
                    transaction_jws: "jws".into(),
                }),
            ),
            (
                "windows_store",
                WindowsStoreProofVerifier.verify(&WindowsStoreProof {
                    store_id_key: "key".into(),
                }),
            ),
            (
                "flatpak",
                FlatpakProofVerifier.verify(&FlatpakProof {
                    token: "tok".into(),
                }),
            ),
        ];
        for (name, result) in cases {
            let err = result.as_ref().unwrap_err();
            assert_eq!(err.code, "channel_not_implemented", "{name}");
            assert!(err.message.contains(name), "{name}: {}", err.message);
        }
        assert_eq!(SteamProofVerifier.channel(), LicenseChannel::Steam);
        assert_eq!(
            MacAppStoreProofVerifier.channel(),
            LicenseChannel::MacAppStore
        );
        assert_eq!(
            WindowsStoreProofVerifier.channel(),
            LicenseChannel::WindowsStore
        );
        assert_eq!(FlatpakProofVerifier.channel(), LicenseChannel::Flatpak);
    }
}
