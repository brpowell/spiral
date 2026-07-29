//! Ed25519 sign / verify for `.spcard` grants.

use super::{err, grant_signing_bytes, Grant, LicenseError};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, Signer, Verifier};

pub use ed25519_dalek::{SigningKey, VerifyingKey};

pub fn verifying_key_from_bytes(bytes: &[u8]) -> Result<VerifyingKey, LicenseError> {
    let arr: [u8; 32] = bytes.try_into().map_err(|_| {
        err(
            "invalid_public_key",
            format!("Ed25519 public key must be 32 bytes, got {}", bytes.len()),
        )
    })?;
    VerifyingKey::from_bytes(&arr).map_err(|e| {
        err(
            "invalid_public_key",
            format!("invalid Ed25519 public key: {e}"),
        )
    })
}

pub fn signing_key_from_bytes(bytes: &[u8]) -> Result<SigningKey, LicenseError> {
    let arr: [u8; 32] = bytes.try_into().map_err(|_| {
        err(
            "invalid_private_key",
            format!("Ed25519 private key must be 32 bytes, got {}", bytes.len()),
        )
    })?;
    Ok(SigningKey::from_bytes(&arr))
}

pub fn sign_grant(signing_key: &SigningKey, grant: &Grant) -> Result<String, LicenseError> {
    let message = grant_signing_bytes(grant);
    let signature: Signature = signing_key.sign(&message);
    Ok(BASE64.encode(signature.to_bytes()))
}

pub fn verify_grant_signature(
    grant: &Grant,
    public_key: &VerifyingKey,
) -> Result<(), LicenseError> {
    let sig_bytes = BASE64.decode(grant.signature.as_bytes()).map_err(|e| {
        err(
            "invalid_signature",
            format!("signature is not valid Base64: {e}"),
        )
    })?;
    let sig_arr: [u8; 64] = sig_bytes.as_slice().try_into().map_err(|_| {
        err(
            "invalid_signature",
            format!(
                "signature must decode to 64 bytes, got {}",
                sig_bytes.len()
            ),
        )
    })?;
    let signature = Signature::from_bytes(&sig_arr);
    let message = grant_signing_bytes(grant);
    public_key.verify(&message, &signature).map_err(|_| {
        err(
            "invalid_signature",
            "grant signature verification failed",
        )
    })
}
