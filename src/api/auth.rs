//! Admin token extraction from request headers.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;

use crate::api::{ApiError, ApiResult};
use crate::AppState;

/// Extracted when `Authorization: Bearer …` or `X-Admin-Token` matches config.
pub struct AdminAuth;

impl FromRequestParts<AppState> for AdminAuth {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        require_admin(parts, state)?;
        Ok(AdminAuth)
    }
}

fn require_admin(parts: &Parts, state: &AppState) -> ApiResult<()> {
    if !state.config.admin_enabled() {
        return Err(ApiError::service_unavailable(
            "admin endpoints disabled: set ADMIN_TOKEN",
        ));
    }

    let expected = &state.config.admin_token;
    let provided = bearer_token(parts).or_else(|| {
        parts
            .headers
            .get("x-admin-token")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    });

    match provided {
        Some(token) if token == *expected => Ok(()),
        _ => Err(ApiError::unauthorized(
            "missing or invalid admin token (Authorization: Bearer … or X-Admin-Token)",
        )),
    }
}

fn bearer_token(parts: &Parts) -> Option<String> {
    let value = parts.headers.get(axum::http::header::AUTHORIZATION)?;
    let value = value.to_str().ok()?;
    let token = value.strip_prefix("Bearer ").or_else(|| value.strip_prefix("bearer "))?;
    Some(token.trim().to_string())
}
