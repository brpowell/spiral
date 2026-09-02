//! Shared MusicBrainz HTTP helpers: user-agent and retry on transient errors.
//!
//! MusicBrainz often answers a brief 503 (cold start / overload) and then
//! succeeds on an immediate retry. Retries stay inside the same lookup so the
//! background toast copy is unchanged; each attempt is logged.

use std::time::Duration;

use crate::activity_log::{self, LogLevel};

/// Total attempts including the first request (two retries after a 503).
pub const MAX_ATTEMPTS: u32 = 3;
const BASE_RETRY_DELAY: Duration = Duration::from_secs(1);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(5);

pub struct RetryContext<'a> {
    pub log_domain: &'a str,
    pub operation: &'a str,
    pub details: serde_json::Value,
}

pub fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 429 | 502 | 503 | 504)
}

pub fn delay_for_attempt(attempt: u32, retry_after: Option<Duration>) -> Duration {
    if let Some(after) = retry_after {
        if !after.is_zero() && after <= MAX_RETRY_DELAY {
            return after;
        }
    }
    BASE_RETRY_DELAY
        .saturating_mul(2u32.pow(attempt))
        .min(MAX_RETRY_DELAY)
}

pub fn retry_after_header(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let raw = headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim();
    raw.parse::<u64>().ok().map(Duration::from_secs)
}

/// GET with retries on 429 / 502 / 503 / 504. Transport errors are not retried
/// so a request timeout cannot stretch into several minutes.
pub fn send_get(
    client: &reqwest::blocking::Client,
    url: &str,
    retry: RetryContext<'_>,
) -> Result<reqwest::blocking::Response, reqwest::Error> {
    let mut attempt = 0u32;
    loop {
        let response = client.get(url).send()?;
        if is_retryable_status(response.status()) && attempt + 1 < MAX_ATTEMPTS {
            let status = response.status();
            let retry_after = retry_after_header(response.headers());
            let delay = delay_for_attempt(attempt, retry_after);
            log_retry(&retry, status, attempt, delay);
            drop(response);
            sleep_retry(delay);
            attempt += 1;
            continue;
        }
        return Ok(response);
    }
}

fn log_retry(retry: &RetryContext<'_>, status: reqwest::StatusCode, attempt: u32, delay: Duration) {
    let mut details = retry.details.clone();
    if let serde_json::Value::Object(map) = &mut details {
        map.insert("httpStatus".into(), status.as_u16().into());
        map.insert("attempt".into(), (attempt + 1).into());
        map.insert("maxAttempts".into(), MAX_ATTEMPTS.into());
        map.insert(
            "retryDelayMs".into(),
            u64::try_from(delay.as_millis()).unwrap_or(u64::MAX).into(),
        );
    }
    activity_log::log(
        LogLevel::Warn,
        retry.log_domain,
        format!(
            "{} returned HTTP {status}, retrying in {}ms",
            retry.operation,
            delay.as_millis()
        ),
        Some(details),
    );
}

fn sleep_retry(delay: Duration) {
    if delay.is_zero() {
        return;
    }
    #[cfg(test)]
    {
        let _ = delay;
    }
    #[cfg(not(test))]
    {
        std::thread::sleep(delay);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;
    use std::thread;
    use tiny_http::{Header, Response, Server};

    fn client() -> reqwest::blocking::Client {
        reqwest::blocking::Client::builder()
            .user_agent(crate::USER_AGENT)
            .timeout(Duration::from_secs(5))
            .build()
            .expect("client")
    }

    fn retry_ctx() -> RetryContext<'static> {
        RetryContext {
            log_domain: "metadata.musicbrainz",
            operation: "MusicBrainz lookup",
            details: serde_json::json!({ "discId": "test-disc" }),
        }
    }

    fn spawn_sequence(
        responses: Vec<(u16, &'static str, Option<&'static str>)>,
    ) -> (String, Arc<AtomicU32>, thread::JoinHandle<()>) {
        let server = Server::http("127.0.0.1:0").expect("bind test server");
        let addr = server.server_addr().to_ip().expect("tcp listen addr");
        let hits = Arc::new(AtomicU32::new(0));
        let hits_for_thread = hits.clone();
        let handle = thread::spawn(move || {
            for (status, body, retry_after) in responses {
                match server.recv_timeout(Duration::from_secs(5)) {
                    Ok(Some(request)) => {
                        hits_for_thread.fetch_add(1, Ordering::SeqCst);
                        let mut response = Response::from_string(body).with_status_code(status);
                        if let Some(retry_after) = retry_after {
                            if let Ok(header) =
                                Header::from_bytes(&b"Retry-After"[..], retry_after.as_bytes())
                            {
                                response = response.with_header(header);
                            }
                        }
                        let _ = request.respond(response);
                    }
                    _ => break,
                }
            }
        });
        (format!("http://{addr}/"), hits, handle)
    }

    #[test]
    fn user_agent_uses_crate_version_and_product_site() {
        assert_eq!(
            crate::USER_AGENT,
            concat!(
                "Spiral/",
                env!("CARGO_PKG_VERSION"),
                " (https://spiralpowered.com)"
            )
        );
        assert!(!crate::USER_AGENT.contains("github.com"));
    }

    #[test]
    fn retryable_status_covers_transient_codes() {
        assert!(is_retryable_status(
            reqwest::StatusCode::SERVICE_UNAVAILABLE
        ));
        assert!(is_retryable_status(reqwest::StatusCode::TOO_MANY_REQUESTS));
        assert!(is_retryable_status(reqwest::StatusCode::BAD_GATEWAY));
        assert!(is_retryable_status(reqwest::StatusCode::GATEWAY_TIMEOUT));
        assert!(!is_retryable_status(reqwest::StatusCode::NOT_FOUND));
        assert!(!is_retryable_status(reqwest::StatusCode::BAD_REQUEST));
        assert!(!is_retryable_status(reqwest::StatusCode::OK));
    }

    #[test]
    fn delay_uses_exponential_backoff_capped_and_honors_retry_after() {
        assert_eq!(delay_for_attempt(0, None), Duration::from_secs(1));
        assert_eq!(delay_for_attempt(1, None), Duration::from_secs(2));
        assert_eq!(delay_for_attempt(2, None), Duration::from_secs(4));
        assert_eq!(delay_for_attempt(3, None), Duration::from_secs(5));
        assert_eq!(
            delay_for_attempt(0, Some(Duration::from_secs(3))),
            Duration::from_secs(3)
        );
        assert_eq!(
            delay_for_attempt(0, Some(Duration::from_secs(30))),
            Duration::from_secs(1)
        );
        assert_eq!(
            delay_for_attempt(0, Some(Duration::ZERO)),
            Duration::from_secs(1)
        );
    }

    #[test]
    fn retry_after_header_parses_delta_seconds() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(reqwest::header::RETRY_AFTER, "2".parse().unwrap());
        assert_eq!(retry_after_header(&headers), Some(Duration::from_secs(2)));
        headers.insert(reqwest::header::RETRY_AFTER, "soon".parse().unwrap());
        assert_eq!(retry_after_header(&headers), None);
    }

    #[test]
    fn retries_after_503_then_succeeds() {
        let (url, hits, handle) =
            spawn_sequence(vec![(503, "busy", None), (200, r#"{"releases":[]}"#, None)]);
        let response = send_get(&client(), &url, retry_ctx()).expect("request");
        assert!(response.status().is_success());
        let body: serde_json::Value = response.json().expect("json");
        assert!(body.get("releases").and_then(|v| v.as_array()).is_some());
        handle.join().expect("server thread");
        assert_eq!(hits.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn does_not_retry_client_errors() {
        let (url, hits, handle) = spawn_sequence(vec![(404, "missing", None)]);
        let response = send_get(&client(), &url, retry_ctx()).expect("request");
        assert_eq!(response.status(), reqwest::StatusCode::NOT_FOUND);
        handle.join().expect("server thread");
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn exhausts_retries_on_persistent_503() {
        let (url, hits, handle) = spawn_sequence(vec![
            (503, "busy", None),
            (503, "busy", None),
            (503, "busy", None),
        ]);
        let response = send_get(&client(), &url, retry_ctx()).expect("request");
        assert_eq!(response.status(), reqwest::StatusCode::SERVICE_UNAVAILABLE);
        handle.join().expect("server thread");
        assert_eq!(hits.load(Ordering::SeqCst), MAX_ATTEMPTS);
    }
}
