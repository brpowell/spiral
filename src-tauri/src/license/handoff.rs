//! Browser → desktop "Add to Spiral" protocol (`spiral://card/install?token=`).

use reqwest::Url;
use serde::Serialize;

pub const HANDOFF_SCHEME: &str = "spiral";
pub const HANDOFF_HOST: &str = "card";
pub const HANDOFF_PATH: &str = "/install";
pub const PRODUCTION_CARD_ORIGIN: &str = "https://spiralpowered.com";
pub const DEBUG_CARD_ORIGIN: &str = "http://127.0.0.1:3000";
const HANDOFF_API_PATH: &str = "/api/card/handoff";
const GRANT_API_PATH: &str = "/api/card/grant";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedHandoff {
    pub token: String,
    pub origin: String,
}

/// Extract token + allowlisted origin from `spiral://card/install?token=…`.
pub fn parse_handoff_url(raw: &str, default_origin: &str) -> Option<ParsedHandoff> {
    let parsed = Url::parse(raw.trim()).ok()?;
    if parsed.scheme() != HANDOFF_SCHEME {
        return None;
    }
    if !handoff_path_matches(&parsed) {
        return None;
    }
    let token = parsed
        .query_pairs()
        .find(|(key, _)| key == "token")
        .map(|(_, value)| value.into_owned())?;
    if !is_plausible_handoff_token(&token) {
        return None;
    }
    let origin = parsed
        .query_pairs()
        .find(|(key, _)| key == "origin")
        .map(|(_, value)| value.into_owned())
        .filter(|origin| is_allowed_card_origin(origin))
        .unwrap_or_else(|| default_origin.trim().trim_end_matches('/').to_string());
    if !is_allowed_card_origin(&origin) {
        return None;
    }
    Some(ParsedHandoff { token, origin })
}

fn handoff_path_matches(parsed: &Url) -> bool {
    let path = parsed.path().trim_end_matches('/');
    match parsed.host_str() {
        Some(host) if host.eq_ignore_ascii_case(HANDOFF_HOST) => {
            path == HANDOFF_PATH || path.is_empty()
        }
        None | Some("") => path == "/card/install" || path == "card/install",
        _ => false,
    }
}

pub fn is_plausible_handoff_token(token: &str) -> bool {
    let len = token.len();
    (16..=128).contains(&len)
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn is_allowed_card_origin(origin: &str) -> bool {
    let Ok(url) = Url::parse(origin.trim()) else {
        return false;
    };
    if url.cannot_be_a_base() {
        return false;
    }
    if url.path() != "/" && !url.path().is_empty() {
        return false;
    }
    if url.query().is_some() || url.fragment().is_some() {
        return false;
    }
    if url.username() != "" || url.password().is_some() {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    match url.scheme() {
        "https" => host.eq_ignore_ascii_case("spiralpowered.com"),
        "http" => host == "127.0.0.1" || host.eq_ignore_ascii_case("localhost"),
        _ => false,
    }
}

pub fn card_origin_from_env(env_value: Option<&str>, debug: bool) -> String {
    let configured = env_value
        .map(str::trim)
        .map(|s| s.trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty());
    if let Some(origin) = configured {
        if is_allowed_card_origin(&origin) {
            return origin;
        }
    }
    if debug {
        DEBUG_CARD_ORIGIN.to_string()
    } else {
        PRODUCTION_CARD_ORIGIN.to_string()
    }
}

pub fn card_handoff_fetch_url(origin: &str, token: &str) -> Result<String, &'static str> {
    if !is_plausible_handoff_token(token) {
        return Err("license.handoff.invalid");
    }
    if !is_allowed_card_origin(origin) {
        return Err("license.handoff.invalid");
    }
    let mut url = Url::parse(origin.trim()).map_err(|_| "license.handoff.invalid")?;
    url.set_path(HANDOFF_API_PATH);
    url.query_pairs_mut().append_pair("token", token);
    Ok(url.to_string())
}

pub fn card_grant_fetch_url(origin: &str) -> Result<String, &'static str> {
    if !is_allowed_card_origin(origin) {
        return Err("license.handoff.invalid");
    }
    let mut url = Url::parse(origin.trim()).map_err(|_| "license.handoff.invalid")?;
    url.set_path(GRANT_API_PATH);
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_spiral_card_install_token() {
        let parsed = parse_handoff_url(
            "spiral://card/install?token=abcdefghijklmnopqrstuv",
            PRODUCTION_CARD_ORIGIN,
        )
        .unwrap();
        assert_eq!(parsed.token, "abcdefghijklmnopqrstuv");
        assert_eq!(parsed.origin, PRODUCTION_CARD_ORIGIN);
        assert_eq!(
            parse_handoff_url(
                "spiral://card/install/?token=abcdefghijklmnopqrstuv",
                PRODUCTION_CARD_ORIGIN,
            )
            .unwrap()
            .token,
            "abcdefghijklmnopqrstuv"
        );
    }

    #[test]
    fn uses_allowlisted_origin_from_the_protocol() {
        let parsed = parse_handoff_url(
            "spiral://card/install?token=abcdefghijklmnopqrstuv&origin=http%3A%2F%2F127.0.0.1%3A3000",
            PRODUCTION_CARD_ORIGIN,
        )
        .unwrap();
        assert_eq!(parsed.origin, "http://127.0.0.1:3000");
    }

    #[test]
    fn ignores_disallowed_origin_and_falls_back() {
        let parsed = parse_handoff_url(
            "spiral://card/install?token=abcdefghijklmnopqrstuv&origin=https%3A%2F%2Fevil.example",
            PRODUCTION_CARD_ORIGIN,
        )
        .unwrap();
        assert_eq!(parsed.origin, PRODUCTION_CARD_ORIGIN);
    }

    #[test]
    fn accepts_empty_host_card_install_path() {
        let parsed = parse_handoff_url(
            "spiral:///card/install?token=abcdefghijklmnopqrstuv",
            PRODUCTION_CARD_ORIGIN,
        )
        .unwrap();
        assert_eq!(parsed.token, "abcdefghijklmnopqrstuv");
    }

    #[test]
    fn rejects_other_schemes_and_paths() {
        assert_eq!(
            parse_handoff_url(
                "https://spiralpowered.com/card/install?token=abcdefghijklmnopqrstuv",
                PRODUCTION_CARD_ORIGIN,
            ),
            None
        );
        assert_eq!(
            parse_handoff_url(
                "spiral://card/other?token=abcdefghijklmnopqrstuv",
                PRODUCTION_CARD_ORIGIN,
            ),
            None
        );
        assert_eq!(
            parse_handoff_url("spiral://card/install", PRODUCTION_CARD_ORIGIN),
            None
        );
        assert_eq!(
            parse_handoff_url("spiral://card/install?token=short", PRODUCTION_CARD_ORIGIN,),
            None
        );
    }

    #[test]
    fn allowlists_production_and_loopback() {
        assert!(is_allowed_card_origin("https://spiralpowered.com"));
        assert!(is_allowed_card_origin("https://spiralpowered.com/"));
        assert!(is_allowed_card_origin("http://127.0.0.1:3000"));
        assert!(is_allowed_card_origin("http://localhost:3000"));
        assert!(!is_allowed_card_origin("https://evil.example"));
        assert!(!is_allowed_card_origin("https://spiralpowered.com/steal"));
        assert!(!is_allowed_card_origin("http://spiralpowered.com"));
    }

    #[test]
    fn env_origin_must_still_be_allowlisted() {
        assert_eq!(
            card_origin_from_env(Some("https://evil.example"), false),
            PRODUCTION_CARD_ORIGIN
        );
        assert_eq!(
            card_origin_from_env(Some("https://spiralpowered.com/"), false),
            "https://spiralpowered.com"
        );
        assert_eq!(
            card_origin_from_env(Some("http://127.0.0.1:3000"), false),
            "http://127.0.0.1:3000"
        );
        assert_eq!(card_origin_from_env(None, true), DEBUG_CARD_ORIGIN);
        assert_eq!(card_origin_from_env(None, false), PRODUCTION_CARD_ORIGIN);
    }

    #[test]
    fn builds_handoff_fetch_url() {
        assert_eq!(
            card_handoff_fetch_url("https://spiralpowered.com", "abcdefghijklmnopqrstuv").unwrap(),
            "https://spiralpowered.com/api/card/handoff?token=abcdefghijklmnopqrstuv"
        );
        assert_eq!(
            card_handoff_fetch_url("https://evil.example", "abcdefghijklmnopqrstuv"),
            Err("license.handoff.invalid")
        );
    }

    #[test]
    fn builds_grant_fetch_url() {
        assert_eq!(
            card_grant_fetch_url("https://spiralpowered.com").unwrap(),
            "https://spiralpowered.com/api/card/grant"
        );
        assert_eq!(
            card_grant_fetch_url("http://127.0.0.1:3000").unwrap(),
            "http://127.0.0.1:3000/api/card/grant"
        );
        assert_eq!(
            card_grant_fetch_url("http://localhost:3000").unwrap(),
            "http://localhost:3000/api/card/grant"
        );
        assert_eq!(
            card_grant_fetch_url("https://evil.example"),
            Err("license.handoff.invalid")
        );
    }
}
