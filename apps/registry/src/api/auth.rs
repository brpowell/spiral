//! Admin token extraction from request headers.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use constant_time_eq::constant_time_eq;
use sha2::{Digest, Sha256};

use crate::api::limit::ClientIp;
use crate::api::{audit, ApiError, ApiResult};
use crate::models::ACTOR_MASTER_TOKEN;
use crate::AppState;

/// Extracted when `Authorization: Bearer …` or `X-Admin-Token` matches config.
///
/// Carries who is acting and from where, for the audit log. There is one shared token today, so
/// the actor is always [`ACTOR_MASTER_TOKEN`]; named tokens would set their own label here.
pub struct AdminAuth {
    pub actor: String,
    pub client_ip: Option<String>,
}

impl FromRequestParts<AppState> for AdminAuth {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let client_ip = parts
            .extensions
            .get::<ClientIp>()
            .map(|ClientIp(ip)| ip.to_string());
        match require_admin(parts, state) {
            Ok(()) => Ok(AdminAuth {
                actor: ACTOR_MASTER_TOKEN.to_string(),
                client_ip,
            }),
            Err(error) => {
                if error.is_unauthorized() {
                    audit::record_denied(
                        state.db.as_ref(),
                        &state.config.admin_path,
                        &parts.method,
                        parts.uri.path(),
                        client_ip,
                        // The caller is unauthenticated, so there is no actor to name.
                        "unauthenticated",
                    )
                    .await;
                }
                Err(error)
            }
        }
    }
}

fn require_admin(parts: &Parts, state: &AppState) -> ApiResult<()> {
    if !state.config.admin_enabled() {
        return Err(ApiError::service_unavailable("admin endpoints disabled"));
    }

    let expected = &state.config.admin_token;
    let provided = bearer_token(parts).or_else(|| {
        parts
            .headers
            .get("x-admin-token")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    });

    let has_token = provided.is_some();
    match provided {
        Some(token) if admin_token_matches(&token, expected) => Ok(()),
        _ => {
            tracing::warn!(
                method = %parts.method,
                path = %parts.uri.path(),
                has_token,
                "admin auth failed"
            );
            Err(ApiError::unauthorized("Invalid token"))
        }
    }
}

/// Compare tokens via SHA-256 so the final eq is fixed-length and constant-time.
fn admin_token_matches(provided: &str, expected: &str) -> bool {
    let provided_digest = Sha256::digest(provided.as_bytes());
    let expected_digest = Sha256::digest(expected.as_bytes());
    constant_time_eq(&provided_digest, &expected_digest)
}

fn bearer_token(parts: &Parts) -> Option<String> {
    let value = parts.headers.get(axum::http::header::AUTHORIZATION)?;
    let value = value.to_str().ok()?;
    let token = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))?;
    Some(token.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matching_tokens_accept() {
        assert!(admin_token_matches("same-token-value", "same-token-value"));
    }

    #[test]
    fn mismatched_tokens_reject() {
        assert!(!admin_token_matches("provided", "expected"));
        assert!(!admin_token_matches(
            "short",
            "a-much-longer-expected-token"
        ));
    }
}
