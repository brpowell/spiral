//! Per-IP request rate limits and download concurrency.
//!
//! Keys on a trusted proxy header ([`crate::config::DEFAULT_CLIENT_IP_HEADER`]
//! by default), then the peer address. Does not read `X-Forwarded-For`
//! (spoofable). Limits are per Machine.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::num::NonZeroU32;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::header::{HeaderName, HeaderValue, RETRY_AFTER};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use governor::clock::{Clock, DefaultClock};
use governor::{Quota, RateLimiter};
use http_body_util::BodyExt;

use super::ApiError;

/// Tight cap on the admin API (`<ADMIN_PATH>/api/*`): token guessing and admin upload.
pub const ADMIN_REQUESTS_PER_MINUTE: u32 = 10;

/// Moderate cap on catalog list/detail, meta, and previews.
pub const CATALOG_REQUESTS_PER_MINUTE: u32 = 120;

/// In-flight `.spk` downloads per client IP (held until the body is dropped).
pub const MAX_CONCURRENT_DOWNLOADS_PER_IP: usize = 4;

type IpLimiter =
    RateLimiter<IpAddr, governor::state::keyed::DefaultKeyedStateStore<IpAddr>, DefaultClock>;

/// How to identify the client for rate limits: a proxy-set header, else the peer.
#[derive(Clone, Debug)]
pub struct ClientIpSource {
    header: Option<HeaderName>,
}

impl ClientIpSource {
    /// `header` is a header name (`fly-client-ip`, `cf-connecting-ip`, …).
    /// Empty means peer address only.
    pub fn new(header: &str) -> Result<Self, axum::http::header::InvalidHeaderName> {
        let header = header.trim();
        if header.is_empty() {
            return Ok(Self { header: None });
        }
        Ok(Self {
            header: Some(HeaderName::try_from(header)?),
        })
    }

    fn extract(&self, request: &Request) -> IpAddr {
        if let Some(name) = &self.header {
            if let Some(ip) = request
                .headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse().ok())
            {
                return ip;
            }
        }
        request
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ConnectInfo(addr)| addr.ip())
            .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
    }
}

#[derive(Clone)]
pub struct RateLimit {
    limiter: Arc<IpLimiter>,
    client_ip: ClientIpSource,
}

impl RateLimit {
    pub fn new(per_minute: u32, client_ip: ClientIpSource) -> Self {
        let burst = NonZeroU32::new(per_minute).expect("per_minute > 0");
        Self {
            limiter: Arc::new(RateLimiter::keyed(Quota::per_minute(burst))),
            client_ip,
        }
    }
}

#[derive(Clone)]
pub struct DownloadLimit {
    slots: DownloadSlots,
    client_ip: ClientIpSource,
}

impl DownloadLimit {
    pub fn new(max_per_ip: usize, client_ip: ClientIpSource) -> Self {
        Self {
            slots: DownloadSlots::new(max_per_ip),
            client_ip,
        }
    }
}

pub async fn rate_limit(State(state): State<RateLimit>, request: Request, next: Next) -> Response {
    let ip = state.client_ip.extract(&request);
    match state.limiter.check_key(&ip) {
        Ok(()) => next.run(request).await,
        Err(not_until) => {
            let wait = not_until.wait_time_from(DefaultClock::default().now());
            tracing::warn!(
                %ip,
                method = %request.method(),
                path = %request.uri().path(),
                wait_ms = wait.as_millis() as u64,
                "rate limited"
            );
            too_many("Too many requests", wait)
        }
    }
}

pub async fn download_concurrency(
    State(state): State<DownloadLimit>,
    request: Request,
    next: Next,
) -> Response {
    let ip = state.client_ip.extract(&request);
    let Some(guard) = state.slots.try_acquire(ip) else {
        tracing::warn!(
            %ip,
            method = %request.method(),
            path = %request.uri().path(),
            "download concurrency limit"
        );
        return ApiError::too_many_requests("Too many concurrent downloads").into_response();
    };

    let response = next.run(request).await;
    let (parts, body) = response.into_parts();
    let guarded = body.map_frame(move |frame| {
        let _hold = &guard;
        frame
    });
    Response::from_parts(parts, Body::new(guarded))
}

fn too_many(message: &'static str, wait: Duration) -> Response {
    let secs = wait.as_secs().max(1);
    let mut response = ApiError::too_many_requests(message).into_response();
    if let Ok(value) = HeaderValue::from_str(&secs.to_string()) {
        response.headers_mut().insert(RETRY_AFTER, value);
    }
    response
}

#[derive(Clone)]
struct DownloadSlots {
    max_per_ip: usize,
    counts: Arc<Mutex<HashMap<IpAddr, usize>>>,
}

struct SlotGuard {
    ip: IpAddr,
    slots: DownloadSlots,
}

impl DownloadSlots {
    fn new(max_per_ip: usize) -> Self {
        Self {
            max_per_ip,
            counts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn try_acquire(&self, ip: IpAddr) -> Option<SlotGuard> {
        let mut counts = self.counts.lock().unwrap_or_else(|e| e.into_inner());
        let count = counts.entry(ip).or_insert(0);
        if *count >= self.max_per_ip {
            return None;
        }
        *count += 1;
        Some(SlotGuard {
            ip,
            slots: self.clone(),
        })
    }

    fn release(&self, ip: IpAddr) {
        let mut counts = self.counts.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(count) = counts.get_mut(&ip) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                counts.remove(&ip);
            }
        }
    }
}

impl Drop for SlotGuard {
    fn drop(&mut self) {
        self.slots.release(self.ip);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request as HttpRequest;

    fn source(header: &str) -> ClientIpSource {
        ClientIpSource::new(header).expect("valid header")
    }

    #[test]
    fn default_header_name_is_valid() {
        ClientIpSource::new(crate::config::DEFAULT_CLIENT_IP_HEADER).unwrap();
    }

    fn req_with(header: &str, value: &str) -> Request {
        HttpRequest::builder()
            .uri("/")
            .header(header, value)
            .body(Body::empty())
            .unwrap()
    }

    #[test]
    fn trusted_header_wins() {
        let src = source("cf-connecting-ip");
        let req = req_with("cf-connecting-ip", "203.0.113.9");
        assert_eq!(src.extract(&req), "203.0.113.9".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn unconfigured_headers_are_ignored() {
        let src = source("x-real-ip");
        let req = HttpRequest::builder()
            .uri("/")
            .header("true-client-ip", "203.0.113.9")
            .header("x-forwarded-for", "198.51.100.1")
            .body(Body::empty())
            .unwrap();
        assert_eq!(src.extract(&req), IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    }

    #[test]
    fn malformed_trusted_header_falls_back() {
        let src = source("x-real-ip");
        let req = req_with("x-real-ip", "not-an-ip");
        assert_eq!(src.extract(&req), IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    }

    #[test]
    fn empty_source_ignores_headers() {
        let src = source("");
        let req = req_with("x-real-ip", "203.0.113.9");
        assert_eq!(src.extract(&req), IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    }

    #[test]
    fn download_slots_cap_and_release() {
        let ip: IpAddr = "203.0.113.9".parse().unwrap();
        let slots = DownloadSlots::new(2);
        let a = slots.try_acquire(ip).unwrap();
        let b = slots.try_acquire(ip).unwrap();
        assert!(slots.try_acquire(ip).is_none());
        drop(a);
        let c = slots.try_acquire(ip).unwrap();
        drop(b);
        drop(c);
        assert!(slots.try_acquire(ip).is_some());
    }

    #[test]
    fn download_slots_are_per_ip() {
        let a: IpAddr = "203.0.113.1".parse().unwrap();
        let b: IpAddr = "203.0.113.2".parse().unwrap();
        let slots = DownloadSlots::new(1);
        let _ga = slots.try_acquire(a).unwrap();
        assert!(slots.try_acquire(a).is_none());
        assert!(slots.try_acquire(b).is_some());
    }
}
