//! Per-IP request rate limits and download concurrency.
//!
//! Keys on a trusted proxy header when `CLIENT_IP_HEADER` names one, else the peer address.
//! Does not read `X-Forwarded-For` (spoofable). IPv6 clients are keyed by their /64, since one
//! host usually controls a whole /64. Limits are per Machine.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::num::NonZeroU32;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::header::{HeaderName, HeaderValue, RETRY_AFTER};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use governor::clock::Clock;
use governor::{Quota, RateLimiter};
use http_body_util::BodyExt;

use super::ApiError;

/// Tight cap on the admin API (`<ADMIN_PATH>/api/*`): token guessing and admin upload.
pub const ADMIN_REQUESTS_PER_MINUTE: u32 = 10;

/// Moderate cap on catalog list/detail, meta, and previews.
pub const CATALOG_REQUESTS_PER_MINUTE: u32 = 120;

/// `.spk` download requests per client per minute. Bounds how fast one client can inflate the
/// download counts, on top of the concurrency cap.
pub const DOWNLOAD_REQUESTS_PER_MINUTE: u32 = 60;

/// In-flight `.spk` downloads per client IP (held until the body is dropped).
pub const MAX_CONCURRENT_DOWNLOADS_PER_IP: usize = 4;

/// How often a limiter drops the state of clients it has not seen recently.
const PRUNE_INTERVAL: Duration = Duration::from_secs(60);

type IpLimiter = RateLimiter<
    IpAddr,
    governor::state::keyed::DefaultKeyedStateStore<IpAddr>,
    LimitClock,
    governor::middleware::NoOpMiddleware<Instant>,
>;

/// The rate limiters' clock: the monotonic clock, or one frozen at a fixed instant so tests can
/// spend a quota without it refilling under them on a slow machine.
#[derive(Clone, Copy, Debug, Default)]
pub struct LimitClock {
    frozen: Option<Instant>,
}

impl LimitClock {
    /// A clock that never advances. For tests.
    pub fn frozen() -> Self {
        Self {
            frozen: Some(Instant::now()),
        }
    }
}

impl Clock for LimitClock {
    type Instant = Instant;

    fn now(&self) -> Instant {
        self.frozen.unwrap_or_else(Instant::now)
    }
}

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

    /// The trusted header's address if present and valid, else the peer address. `None` only
    /// when neither is known. The header is absent on the private admin listener, where the
    /// peer address is the best there is.
    fn resolve(&self, request: &Request) -> Option<IpAddr> {
        if let Some(name) = &self.header {
            if let Some(ip) = request
                .headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse().ok())
            {
                return Some(ip);
            }
        }
        request
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ConnectInfo(addr)| addr.ip())
    }

    /// The rate-limit key: [`Self::resolve`] passed through [`limit_key`], with a placeholder
    /// when nothing is known.
    fn extract(&self, request: &Request) -> IpAddr {
        self.resolve(request)
            .map(limit_key)
            .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
    }
}

/// The key a client's limits are counted under: IPv4 addresses as they are (including
/// IPv4-mapped IPv6), IPv6 addresses truncated to their /64. A single host or subscriber is
/// typically given a whole /64, so keying on the full address would let it rotate freely.
fn limit_key(ip: IpAddr) -> IpAddr {
    match ip.to_canonical() {
        IpAddr::V6(v6) => {
            let prefix = u128::from(v6) & !((1u128 << 64) - 1);
            IpAddr::V6(Ipv6Addr::from(prefix))
        }
        v4 => v4,
    }
}

/// The client address resolved by [`ClientIpSource`], attached to the request by
/// [`attach_client_ip`] so handlers (the admin audit log) see the same address the rate limits
/// key on.
#[derive(Clone, Copy, Debug)]
pub struct ClientIp(pub IpAddr);

/// Middleware: resolve the client address and store it as a [`ClientIp`] request extension.
pub async fn attach_client_ip(
    State(source): State<ClientIpSource>,
    mut request: Request,
    next: Next,
) -> Response {
    if let Some(ip) = source.resolve(&request) {
        request.extensions_mut().insert(ClientIp(ip));
    }
    next.run(request).await
}

#[derive(Clone)]
pub struct RateLimit {
    limiter: Arc<IpLimiter>,
    clock: LimitClock,
    client_ip: ClientIpSource,
    /// When the keyed store was last pruned, in milliseconds since `started`.
    last_prune_ms: Arc<AtomicU64>,
    started: Instant,
}

impl RateLimit {
    pub fn new(per_minute: u32, client_ip: ClientIpSource, clock: LimitClock) -> Self {
        let burst = NonZeroU32::new(per_minute).expect("per_minute > 0");
        Self::with_quota(Quota::per_minute(burst), client_ip, clock)
    }

    fn with_quota(quota: Quota, client_ip: ClientIpSource, clock: LimitClock) -> Self {
        Self {
            limiter: Arc::new(RateLimiter::new(quota, Default::default(), clock)),
            clock,
            client_ip,
            last_prune_ms: Arc::new(AtomicU64::new(0)),
            started: Instant::now(),
        }
    }

    /// Drop the state of clients whose quota has fully refilled, at most once per
    /// [`PRUNE_INTERVAL`]. The keyed store otherwise grows by one entry per address ever seen.
    /// Runs on the request path, so no background task is needed; one request per interval
    /// pays for a pass over the store.
    fn maybe_prune(&self) {
        let now = self.started.elapsed().as_millis() as u64;
        let last = self.last_prune_ms.load(Ordering::Relaxed);
        if now.saturating_sub(last) < PRUNE_INTERVAL.as_millis() as u64 {
            return;
        }
        if self
            .last_prune_ms
            .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            self.limiter.retain_recent();
            self.limiter.shrink_to_fit();
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
    state.maybe_prune();
    let ip = state.client_ip.extract(&request);
    match state.limiter.check_key(&ip) {
        Ok(()) => next.run(request).await,
        Err(not_until) => {
            let wait = not_until.wait_time_from(state.clock.now());
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
    fn ipv6_clients_are_keyed_by_their_64() {
        let key = |s: &str| limit_key(s.parse().unwrap());
        assert_eq!(key("2001:db8:1:2:aaaa::1"), key("2001:db8:1:2:ffff::9"));
        assert_eq!(
            key("2001:db8:1:2:aaaa::1"),
            "2001:db8:1:2::".parse::<IpAddr>().unwrap()
        );
        assert_ne!(key("2001:db8:1:2::1"), key("2001:db8:1:3::1"));
        assert_eq!(key("203.0.113.9"), "203.0.113.9".parse::<IpAddr>().unwrap());
        assert_eq!(
            key("::ffff:203.0.113.9"),
            "203.0.113.9".parse::<IpAddr>().unwrap()
        );
    }

    #[test]
    fn rate_limit_key_masks_the_resolved_address() {
        let src = source("x-real-ip");
        let req = req_with("x-real-ip", "2001:db8:1:2:3:4:5:6");
        assert_eq!(
            src.extract(&req),
            "2001:db8:1:2::".parse::<IpAddr>().unwrap()
        );
    }

    #[test]
    fn pruning_drops_idle_clients_once_per_interval() {
        // 1000 per second refills in a millisecond, so idle clients are prunable almost at once.
        let quota = Quota::per_second(NonZeroU32::new(1000).unwrap());
        let mut limit = RateLimit::with_quota(quota, source(""), LimitClock::default());
        for i in 0..10u8 {
            let _ = limit
                .limiter
                .check_key(&IpAddr::V4(Ipv4Addr::new(203, 0, 113, i)));
        }
        assert_eq!(limit.limiter.len(), 10);
        std::thread::sleep(Duration::from_millis(20));

        limit.maybe_prune();
        assert_eq!(limit.limiter.len(), 10, "no pass within the first interval");

        limit.started = Instant::now()
            .checked_sub(PRUNE_INTERVAL * 2)
            .expect("monotonic clock is past two intervals");
        limit.maybe_prune();
        assert_eq!(limit.limiter.len(), 0);
    }

    #[test]
    fn a_frozen_clock_never_refills_a_spent_quota() {
        // 1000 per second would refill 20 cells during the sleep on the real clock.
        let quota = Quota::per_second(NonZeroU32::new(1000).unwrap()).allow_burst(NonZeroU32::MIN);
        let limit = RateLimit::with_quota(quota, source(""), LimitClock::frozen());
        let ip = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 1));
        assert!(limit.limiter.check_key(&ip).is_ok());
        std::thread::sleep(Duration::from_millis(20));
        assert!(limit.limiter.check_key(&ip).is_err());
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
