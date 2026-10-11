//! Wikimedia (Wikipedia / Wikidata / Commons) HTTP: identifiable UA, timeouts,
//! and 429 / Retry-After. Do not reuse the MusicBrainz retry cadence (503 / 502).

use std::time::Duration;

pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_ATTEMPTS: u32 = 3;
const DEFAULT_RETRY_DELAY: Duration = Duration::from_secs(1);
const MAX_RETRY_AFTER: Duration = Duration::from_secs(5);

pub struct GetAttempt {
    pub attempts: u32,
    pub result: Result<reqwest::blocking::Response, reqwest::Error>,
}

pub fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(crate::USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

pub fn format_http_error(operation: &str, status: reqwest::StatusCode, attempts: u32) -> String {
    with_attempt_suffix(format!("{operation} failed with HTTP {status}"), attempts)
}

pub fn format_transport_error(operation: &str, err: &reqwest::Error, attempts: u32) -> String {
    let message = if err.is_timeout() {
        format!(
            "{operation} timed out after {} seconds",
            REQUEST_TIMEOUT.as_secs()
        )
    } else if err.is_connect() {
        format!("{operation} connection failed: {err}")
    } else {
        format!("{operation} failed: {err}")
    };
    with_attempt_suffix(message, attempts)
}

fn with_attempt_suffix(message: String, attempts: u32) -> String {
    if attempts > 1 {
        format!("{message} ({attempts} attempts)")
    } else {
        message
    }
}

fn retry_after_header(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let raw = headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim();
    raw.parse::<u64>().ok().map(Duration::from_secs)
}

fn delay_for_429(retry_after: Option<Duration>) -> Duration {
    match retry_after {
        Some(after) if !after.is_zero() && after <= MAX_RETRY_AFTER => after,
        _ => DEFAULT_RETRY_DELAY,
    }
}

/// GET that retries only on HTTP 429, honoring Retry-After (capped).
pub fn send_get(client: &reqwest::blocking::Client, url: &str) -> GetAttempt {
    let mut attempt = 0u32;
    loop {
        match client.get(url).send() {
            Ok(response) => {
                if response.status().as_u16() == 429 && attempt + 1 < MAX_ATTEMPTS {
                    let delay = delay_for_429(retry_after_header(response.headers()));
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
        http_client().expect("client")
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
    fn delay_honors_retry_after_when_capped() {
        assert_eq!(delay_for_429(None), DEFAULT_RETRY_DELAY);
        assert_eq!(
            delay_for_429(Some(Duration::from_secs(3))),
            Duration::from_secs(3)
        );
        assert_eq!(
            delay_for_429(Some(Duration::from_secs(30))),
            DEFAULT_RETRY_DELAY
        );
        assert_eq!(delay_for_429(Some(Duration::ZERO)), DEFAULT_RETRY_DELAY);
    }

    #[test]
    fn retries_after_429_then_succeeds() {
        let (url, hits, handle) = spawn_sequence(vec![
            (429, "slow down", Some("1")),
            (200, r#"{"query":{}}"#, None),
        ]);
        let response = send_get(&client(), &url).result.expect("request");
        assert!(response.status().is_success());
        handle.join().expect("server thread");
        assert_eq!(hits.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn does_not_retry_503() {
        let (url, hits, handle) = spawn_sequence(vec![(503, "busy", None)]);
        let response = send_get(&client(), &url).result.expect("request");
        assert_eq!(response.status(), reqwest::StatusCode::SERVICE_UNAVAILABLE);
        handle.join().expect("server thread");
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn exhausts_retries_on_persistent_429() {
        let (url, hits, handle) = spawn_sequence(vec![
            (429, "slow", None),
            (429, "slow", None),
            (429, "slow", None),
        ]);
        let got = send_get(&client(), &url);
        let response = got.result.expect("request");
        assert_eq!(response.status(), reqwest::StatusCode::TOO_MANY_REQUESTS);
        handle.join().expect("server thread");
        assert_eq!(hits.load(Ordering::SeqCst), MAX_ATTEMPTS);
        assert_eq!(got.attempts, MAX_ATTEMPTS);
    }
}
