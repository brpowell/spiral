//! Who may call the API.
//!
//! Every request must carry `Authorization: Bearer <token>`. The peer's
//! address never counts: a request from loopback or the local network is
//! treated like any other, so a process on the same machine or a device on
//! the same Wi-Fi gets nothing without a token.

use axum::extract::{Request, State};
use axum::http::header::{AUTHORIZATION, WWW_AUTHENTICATE};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::routes::error_response;

/// A boxed future from an [`Authenticator`].
pub type AuthFuture<'a> = Pin<Box<dyn Future<Output = Option<AuthedDevice>> + Send + 'a>>;

/// The device a request authenticated as. Handlers find it in the request's
/// extensions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthedDevice {
    pub device_id: String,
}

/// Decides whether a bearer token belongs to a device. The future is boxed
/// so the router can hold any authenticator as `Arc<dyn Authenticator>`, and
/// so one that looks tokens up in storage can await.
pub trait Authenticator: Send + Sync + 'static {
    fn authenticate<'a>(&'a self, token: &'a str) -> AuthFuture<'a>;
}

/// One fixed token for development, until pairing issues per-device tokens.
/// Every request that presents it is the device `dev`.
pub struct DevTokenAuth {
    token: String,
}

impl DevTokenAuth {
    pub const DEVICE_ID: &'static str = "dev";

    pub fn new(token: impl Into<String>) -> Self {
        DevTokenAuth {
            token: token.into(),
        }
    }
}

impl std::fmt::Debug for DevTokenAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DevTokenAuth").finish_non_exhaustive()
    }
}

impl Authenticator for DevTokenAuth {
    fn authenticate<'a>(&'a self, token: &'a str) -> AuthFuture<'a> {
        // Constant time, so response timing doesn't reveal how much of a
        // guess matched. An empty configured token never matches.
        let ok = !self.token.is_empty()
            && constant_time_eq::constant_time_eq(token.as_bytes(), self.token.as_bytes());
        Box::pin(async move {
            ok.then(|| AuthedDevice {
                device_id: Self::DEVICE_ID.to_string(),
            })
        })
    }
}

/// The token from `Authorization: Bearer <token>`, if the header is exactly
/// that. The scheme is case-insensitive (RFC 9110).
fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let mut values = headers.get_all(AUTHORIZATION).iter();
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    let (scheme, token) = value.to_str().ok()?.split_once(' ')?;
    let token = token.trim_start_matches(' ');
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty() && !token.contains(' '))
        .then_some(token)
}

pub(crate) async fn require_auth(
    State(auth): State<Arc<dyn Authenticator>>,
    mut request: Request,
    next: Next,
) -> Response {
    let device = match bearer_token(request.headers()) {
        Some(token) => auth.authenticate(token).await,
        None => None,
    };
    match device {
        Some(device) => {
            request.extensions_mut().insert(device);
            next.run(request).await
        }
        None => unauthorized(),
    }
}

fn unauthorized() -> Response {
    let mut response = error_response(StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    response
        .headers_mut()
        .insert(WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(values: &[&str]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for v in values {
            map.append(AUTHORIZATION, HeaderValue::from_str(v).unwrap());
        }
        map
    }

    #[test]
    fn reads_a_bearer_token() {
        assert_eq!(bearer_token(&headers(&["Bearer abc"])), Some("abc"));
        assert_eq!(bearer_token(&headers(&["bearer abc"])), Some("abc"));
        assert_eq!(bearer_token(&headers(&["BEARER  abc"])), Some("abc"));
    }

    #[test]
    fn rejects_anything_else() {
        assert_eq!(bearer_token(&headers(&[])), None);
        assert_eq!(bearer_token(&headers(&["Bearer"])), None);
        assert_eq!(bearer_token(&headers(&["Bearer "])), None);
        assert_eq!(bearer_token(&headers(&["Basic abc"])), None);
        assert_eq!(bearer_token(&headers(&["abc"])), None);
        assert_eq!(bearer_token(&headers(&["Bearer a b"])), None);
        assert_eq!(bearer_token(&headers(&["Bearer a", "Bearer a"])), None);
    }

    #[tokio::test]
    async fn dev_token_matches_only_itself() {
        let auth = DevTokenAuth::new("secret");
        assert_eq!(
            auth.authenticate("secret").await,
            Some(AuthedDevice {
                device_id: "dev".into()
            })
        );
        assert_eq!(auth.authenticate("secreT").await, None);
        assert_eq!(auth.authenticate("secret2").await, None);
        assert_eq!(auth.authenticate("").await, None);
        assert_eq!(DevTokenAuth::new("").authenticate("").await, None);
    }
}
