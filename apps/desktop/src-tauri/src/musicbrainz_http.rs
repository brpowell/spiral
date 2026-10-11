//! Shared MusicBrainz HTTP helpers: user-agent and retry on transient errors.
//!
//! MusicBrainz cold start / overload often surfaces as a brief 503 *or* a hung
//! connection that times out; both usually succeed on the next attempt. Retries
//! stay inside the same lookup (toast copy unchanged) and are not logged unless
//! the caller reports a final failure.

use std::error::Error as StdError;
use std::time::Duration;

/// Total attempts including the first request (two retries after a 503).
pub const MAX_ATTEMPTS: u32 = 3;
const BASE_RETRY_DELAY: Duration = Duration::from_secs(1);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(5);

/// One GET, including any silent retries.
pub struct GetAttempt {
    pub attempts: u32,
    pub result: Result<reqwest::blocking::Response, reqwest::Error>,
}

fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 429 | 502 | 503 | 504)
}

fn is_retryable_transport(err: &reqwest::Error) -> bool {
    err.is_timeout() || err.is_connect()
}

fn reqwest_error_kind(err: &reqwest::Error) -> &'static str {
    if err.is_timeout() {
        "timeout"
    } else if err.is_connect() {
        "connect"
    } else if err.is_request() {
        "request"
    } else if err.is_body() {
        "body"
    } else if err.is_decode() {
        "decode"
    } else if err.is_status() {
        "status"
    } else {
        "other"
    }
}

pub fn format_transport_error(
    operation: &str,
    err: &reqwest::Error,
    timeout: Duration,
    attempts: u32,
) -> String {
    let message = if err.is_timeout() {
        format!("{operation} timed out after {} seconds", timeout.as_secs())
    } else if err.is_connect() {
        format!("{operation} connection failed: {err}")
    } else if let Some(status) = err.status() {
        format!("{operation} failed with HTTP {}", status.as_u16())
    } else {
        format!("{operation} failed ({}): {err}", reqwest_error_kind(err))
    };
    with_attempt_suffix(message, attempts)
}

pub fn format_http_error(operation: &str, status: reqwest::StatusCode, attempts: u32) -> String {
    with_attempt_suffix(format!("{operation} failed with HTTP {status}"), attempts)
}

fn with_attempt_suffix(message: String, attempts: u32) -> String {
    if attempts > 1 {
        format!("{message} ({attempts} attempts)")
    } else {
        message
    }
}

pub fn transport_error_details(
    err: &reqwest::Error,
    timeout: Duration,
    attempts: u32,
) -> serde_json::Value {
    let mut details = serde_json::json!({
        "errorKind": reqwest_error_kind(err),
        "errorDetail": err.to_string(),
        "timeoutSecs": timeout.as_secs(),
        "attempts": attempts,
        "maxAttempts": MAX_ATTEMPTS,
    });
    if let Some(status) = err.status() {
        details["httpStatus"] = serde_json::json!(status.as_u16());
    }
    if let Some(url) = err.url() {
        details["url"] = serde_json::json!(url.to_string());
    }
    if let Some(source) = StdError::source(err) {
        details["source"] = serde_json::json!(source.to_string());
    }
    details
}

fn delay_for_attempt(attempt: u32, retry_after: Option<Duration>) -> Duration {
    if let Some(after) = retry_after {
        if !after.is_zero() && after <= MAX_RETRY_DELAY {
            return after;
        }
    }
    BASE_RETRY_DELAY
        .saturating_mul(2u32.pow(attempt))
        .min(MAX_RETRY_DELAY)
}

fn retry_after_header(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let raw = headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim();
    raw.parse::<u64>().ok().map(Duration::from_secs)
}

/// GET with silent retries on 429 / 502 / 503 / 504 and on connect/timeout errors.
pub fn send_get(client: &reqwest::blocking::Client, url: &str) -> GetAttempt {
    let mut attempt = 0u32;
    loop {
        match client.get(url).send() {
            Ok(response) => {
                if is_retryable_status(response.status()) && attempt + 1 < MAX_ATTEMPTS {
                    let retry_after = retry_after_header(response.headers());
                    let delay = delay_for_attempt(attempt, retry_after);
                    drop(response);
                    sleep_retry(delay);
                    attempt += 1;
                    continue;
                }
                return GetAttempt {
                    attempts: attempt + 1,
                    result: Ok(response),
                };
            }
            Err(err) if is_retryable_transport(&err) && attempt + 1 < MAX_ATTEMPTS => {
                let delay = delay_for_attempt(attempt, None);
                sleep_retry(delay);
                attempt += 1;
            }
            Err(err) => {
                return GetAttempt {
                    attempts: attempt + 1,
                    result: Err(err),
                };
            }
        }
    }
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
        let response = send_get(&client(), &url).result.expect("request");
        assert!(response.status().is_success());
        let body: serde_json::Value = response.json().expect("json");
        assert!(body.get("releases").and_then(|v| v.as_array()).is_some());
        handle.join().expect("server thread");
        assert_eq!(hits.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn does_not_retry_client_errors() {
        let (url, hits, handle) = spawn_sequence(vec![(404, "missing", None)]);
        let response = send_get(&client(), &url).result.expect("request");
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
        let got = send_get(&client(), &url);
        let attempts = got.attempts;
        let response = got.result.expect("request");
        assert_eq!(response.status(), reqwest::StatusCode::SERVICE_UNAVAILABLE);
        handle.join().expect("server thread");
        assert_eq!(hits.load(Ordering::SeqCst), MAX_ATTEMPTS);
        assert_eq!(attempts, MAX_ATTEMPTS);
    }

    fn client_with_timeout(timeout: Duration) -> reqwest::blocking::Client {
        reqwest::blocking::Client::builder()
            .user_agent(crate::USER_AGENT)
            .timeout(timeout)
            .build()
            .expect("client")
    }

    fn spawn_hang_then_http(
        hang_count: u32,
        body: &'static str,
    ) -> (String, Arc<AtomicU32>, thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let hits = Arc::new(AtomicU32::new(0));
        let hits_for_thread = hits.clone();
        let handle = thread::spawn(move || {
            for _ in 0..hang_count {
                let Ok((stream, _)) = listener.accept() else {
                    return;
                };
                hits_for_thread.fetch_add(1, Ordering::SeqCst);
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(30));
                    drop(stream);
                });
            }
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            hits_for_thread.fetch_add(1, Ordering::SeqCst);
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf);
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(body.as_bytes());
        });
        (format!("http://{addr}/"), hits, handle)
    }

    fn spawn_hangs(count: u32) -> (String, Arc<AtomicU32>, thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let hits = Arc::new(AtomicU32::new(0));
        let hits_for_thread = hits.clone();
        let handle = thread::spawn(move || {
            for _ in 0..count {
                let Ok((stream, _)) = listener.accept() else {
                    return;
                };
                hits_for_thread.fetch_add(1, Ordering::SeqCst);
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(30));
                    drop(stream);
                });
            }
        });
        (format!("http://{addr}/"), hits, handle)
    }

    #[test]
    fn retries_after_timeout_then_succeeds() {
        let (url, hits, handle) = spawn_hang_then_http(1, r#"{"releases":[]}"#);
        let response = send_get(&client_with_timeout(Duration::from_millis(200)), &url)
            .result
            .expect("request");
        assert!(response.status().is_success());
        handle.join().expect("server thread");
        assert_eq!(hits.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn exhausts_retries_on_persistent_timeout() {
        let (url, hits, handle) = spawn_hangs(MAX_ATTEMPTS);
        let got = send_get(&client_with_timeout(Duration::from_millis(200)), &url);
        let err = got.result.expect_err("should time out");
        assert!(err.is_timeout(), "unexpected error: {err}");
        handle.join().expect("server thread");
        assert_eq!(hits.load(Ordering::SeqCst), MAX_ATTEMPTS);
        assert_eq!(got.attempts, MAX_ATTEMPTS);
    }

    #[test]
    fn format_transport_error_names_timeout_and_connect() {
        let err = client_with_timeout(Duration::from_millis(1))
            .get("http://127.0.0.1:1")
            .send()
            .expect_err("request should fail");
        let message = format_transport_error(
            "MusicBrainz release search",
            &err,
            Duration::from_secs(10),
            1,
        );
        assert!(
            message.contains("timed out") || message.contains("connection failed"),
            "unexpected message: {message}"
        );
        assert!(
            !message.contains("attempts"),
            "single attempt should not mention retries: {message}"
        );
        let retried = format_transport_error(
            "MusicBrainz release search",
            &err,
            Duration::from_secs(10),
            3,
        );
        assert!(
            retried.contains("(3 attempts)"),
            "unexpected retried message: {retried}"
        );
        let details = transport_error_details(&err, Duration::from_secs(10), 3);
        assert_eq!(
            details["errorKind"].as_str().unwrap(),
            reqwest_error_kind(&err)
        );
        assert_eq!(details["timeoutSecs"], 10);
    }
}
