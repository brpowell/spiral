//! Ed25519 verify for `.spcard` grants. Signing lives in spiral-powered.

use super::{err, grant_signing_bytes, Grant, LicenseError};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, Verifier};
use obfstr::obfstr;

pub use ed25519_dalek::VerifyingKey;

// Diagnostic messages are compile-time XOR-obfuscated (obfstr): they are the
// distinctive plaintext anchors a reverse-engineer uses to locate the verifier
// in a stripped binary (the red-team pinned this function via
// "grant signature verification failed"). obfstr decodes them on the stack at
// runtime, so logs are unchanged but `strings` no longer sees them. The short
// `code` tokens stay as-is: several are server wire-contract values and all are
// generic enough not to anchor this function once the messages are gone.

pub fn verifying_key_from_bytes(bytes: &[u8]) -> Result<VerifyingKey, LicenseError> {
    let arr: [u8; 32] = bytes.try_into().map_err(|_| {
        err(
            "invalid_public_key",
            format!(
                "{} {}",
                obfstr!("Ed25519 public key must be 32 bytes, got"),
                bytes.len()
            ),
        )
    })?;
    VerifyingKey::from_bytes(&arr).map_err(|e| {
        err(
            "invalid_public_key",
            format!("{}: {e}", obfstr!("invalid Ed25519 public key")),
        )
    })
}

pub fn verify_grant_signature(
    grant: &Grant,
    public_key: &VerifyingKey,
) -> Result<(), LicenseError> {
    let sig_bytes = BASE64.decode(grant.signature.as_bytes()).map_err(|e| {
        err(
            "invalid_signature",
            format!("{}: {e}", obfstr!("signature is not valid Base64")),
        )
    })?;
    let sig_arr: [u8; 64] = sig_bytes.as_slice().try_into().map_err(|_| {
        err(
            "invalid_signature",
            format!(
                "{} {}",
                obfstr!("signature must decode to 64 bytes, got"),
                sig_bytes.len()
            ),
        )
    })?;
    let signature = Signature::from_bytes(&sig_arr);
    let message = grant_signing_bytes(grant);
    public_key.verify(&message, &signature).map_err(|_| {
        err(
            "invalid_signature",
            obfstr!("grant signature verification failed"),
        )
    })
}
