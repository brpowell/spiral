//! Linux backend: WebKitGTK `evaluate_javascript` and `snapshot`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use javascriptcore::ValueExt as _;
use serde_json::Value;
use tauri::WebviewWindow;
use webkit2gtk::{gio::Cancellable, glib, SnapshotOptions, SnapshotRegion, WebViewExt as _};

/// WebKitGTK's `evaluate_javascript` does not await promises, so the body
/// runs detached in the page, parks its JSON result on `window.__agentResults`,
/// and this polls until it appears (like `callAsyncJavaScript` on macOS).
pub fn eval(window: &WebviewWindow, body: String, timeout: Duration) -> Result<String, String> {
    static NEXT_ID: AtomicU64 = AtomicU64::new(0);
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let start = format!(
        "void (async () => {{ {body} }})().then((r) => {{ (window.__agentResults ??= {{}})[{id}] = r; }});"
    );
    run_script(window, start, timeout)?;
    let poll = format!(
        "(() => {{ const r = window.__agentResults?.[{id}]; \
         if (r === undefined) return ''; delete window.__agentResults[{id}]; return r; }})()"
    );
    let deadline = Instant::now() + timeout;
    loop {
        let result = run_script(window, poll.clone(), timeout)?;
        if !result.is_empty() {
            return Ok(result);
        }
        if Instant::now() >= deadline {
            return Err("eval timed out".to_string());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Run a script on the main thread and return its (string) result.
fn run_script(window: &WebviewWindow, script: String, timeout: Duration) -> Result<String, String> {
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    window
        .with_webview(move |platform| {
            platform.inner().evaluate_javascript(
                &script,
                None,
                None,
                None::<&Cancellable>,
                move |result| {
                    let _ = tx.send(match result {
                        Ok(value) => Ok(value.to_str().to_string()),
                        Err(err) => Err(err.message().to_string()),
                    });
                },
            );
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(timeout)
        .map_err(|_| "eval timed out".to_string())?
}

pub fn snapshot(window: &WebviewWindow, timeout: Duration) -> Result<Vec<u8>, String> {
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    window
        .with_webview(move |platform| {
            let webview = platform.inner();
            webview.snapshot(
                SnapshotRegion::Visible,
                SnapshotOptions::NONE,
                None::<&Cancellable>,
                move |result| {
                    let _ = tx.send(
                        result
                            .map_err(|e: glib::Error| e.message().to_string())
                            .and_then(png_from_surface),
                    );
                },
            );
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(timeout)
        .map_err(|_| "snapshot timed out".to_string())?
}

fn png_from_surface(surface: cairo::Surface) -> Result<Vec<u8>, String> {
    let image = cairo::ImageSurface::try_from(surface)
        .map_err(|_| "snapshot was not an image surface".to_string())?;
    let mut png = Vec::new();
    image.write_to_png(&mut png).map_err(|e| e.to_string())?;
    Ok(png)
}

pub fn capture(
    _window: &WebviewWindow,
    _out: PathBuf,
    _timeout: Duration,
) -> Result<Value, String> {
    Err("`capture` (native window frame + shadow) is macOS-only; use `shot` on Linux".to_string())
}
