//! Running the router on a listener or a single stream.

use axum::serve::Listener;
use axum::Router;
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto;
use hyper_util::service::TowerToHyperService;
use std::error::Error;
use std::fmt::Debug;
use std::future::Future;
use tokio::io::{AsyncRead, AsyncWrite};

/// Serves `router` on every connection `listener` accepts until `shutdown`
/// completes, then lets in-flight requests finish.
///
/// The host opens the listener (TCP, a Unix socket, anything implementing
/// [`Listener`]); this crate never binds an address. The router never sees
/// the peer address, so no request is trusted for where it comes from.
pub async fn serve<L>(
    listener: L,
    router: Router,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> std::io::Result<()>
where
    L: Listener,
    L::Addr: Debug,
{
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown)
        .await
}

/// Serves `router` on one stream that is already connected, HTTP/1.1 or
/// HTTP/2, until the peer closes it. For transports where the host dials out
/// rather than listens, such as a USB link to a device.
pub async fn serve_connection<IO>(
    io: IO,
    router: Router,
) -> Result<(), Box<dyn Error + Send + Sync>>
where
    IO: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    auto::Builder::new(TokioExecutor::new())
        .serve_connection(TokioIo::new(io), TowerToHyperService::new(router))
        .await
}
