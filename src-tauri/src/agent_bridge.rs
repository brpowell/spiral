//! Dev-only agent bridge: lets a coding agent drive the running app.
//!
//! A private Unix socket (`$TMPDIR/spiral-agent.sock`, mode 0600) speaks one
//! JSON object per line. `scripts/agent.mjs` is the client. Commands:
//!
//! * `windows`                      — list window labels + visibility
//! * `show {window}`                — show + focus a (possibly hidden) window
//! * `eval {window, body}`          — run an async JS function body in the page
//!                                    world; the returned value comes back as JSON
//! * `shot {window}`                — PNG snapshot of the webview (base64)
//!
//! Compiled only with `--features agent-bridge` in a debug build on macOS; the
//! cfg guard lives at every call site so none of this can reach a release.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use base64::Engine;
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
use objc2_foundation::{NSDictionary, NSError, NSString};
use objc2_web_kit::{WKContentWorld, WKSnapshotConfiguration, WKWebView};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewWindow};

/// Console/error buffer injected into every window the bridge can reach.
pub const INIT_SCRIPT: &str = include_str!("agent_bridge.js");

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(15);

pub fn socket_path() -> PathBuf {
    std::env::temp_dir().join("spiral-agent.sock")
}

pub fn start(app: AppHandle) {
    let path = socket_path();
    let _ = std::fs::remove_file(&path);
    let listener = match UnixListener::bind(&path) {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("[agent-bridge] bind {}: {err}", path.display());
            return;
        }
    };
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    eprintln!("[agent-bridge] listening on {}", path.display());
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || serve(app, stream));
        }
    });
}

fn serve(app: AppHandle, stream: UnixStream) {
    let Ok(mut writer) = stream.try_clone() else {
        return;
    };
    for line in BufReader::new(stream).lines().map_while(Result::ok) {
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(request) => match handle(&app, &request) {
                Ok(mut value) => {
                    value["ok"] = json!(true);
                    value
                }
                Err(error) => json!({ "ok": false, "error": error }),
            },
            Err(err) => json!({ "ok": false, "error": format!("bad request: {err}") }),
        };
        if writeln!(writer, "{reply}").is_err() {
            return;
        }
    }
}

fn handle(app: &AppHandle, request: &Value) -> Result<Value, String> {
    let cmd = request["cmd"].as_str().ok_or("missing `cmd`")?;
    if cmd == "windows" {
        let mut windows: Vec<Value> = app
            .webview_windows()
            .into_iter()
            .map(|(label, window)| {
                json!({
                    "label": label,
                    "title": window.title().ok(),
                    "visible": window.is_visible().unwrap_or(false),
                    "focused": window.is_focused().unwrap_or(false),
                })
            })
            .collect();
        windows.sort_by_key(|w| w["label"].as_str().unwrap_or_default().to_string());
        return Ok(json!({ "windows": windows }));
    }

    let label = request["window"].as_str().unwrap_or("main");
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("no window `{label}`"))?;
    let timeout = request["timeout_ms"]
        .as_u64()
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_TIMEOUT);

    match cmd {
        "show" => {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
            Ok(json!({}))
        }
        "eval" => {
            let body = request["body"].as_str().ok_or("missing `body`")?;
            let json_text = eval(&window, wrap_body(body), timeout)?;
            let value: Value = serde_json::from_str(&json_text).map_err(|e| e.to_string())?;
            if let Some(err) = value.get("__agentError").and_then(Value::as_str) {
                return Err(err.to_string());
            }
            Ok(json!({ "value": value }))
        }
        "shot" => {
            let png = snapshot(&window, timeout)?;
            let png = base64::engine::general_purpose::STANDARD.encode(png);
            Ok(json!({ "png": png }))
        }
        other => Err(format!("unknown cmd `{other}`")),
    }
}

/// `callAsyncJavaScript` takes a function body and awaits the returned
/// promise. Results travel as a JSON string so any serializable value works.
fn wrap_body(user: &str) -> String {
    format!(
        "try {{ const __r = await (async () => {{ {user}\n }})(); \
         return JSON.stringify(__r === undefined ? null : __r); }} \
         catch (e) {{ return JSON.stringify({{ __agentError: String((e && e.stack) || e) }}); }}"
    )
}

fn eval(window: &WebviewWindow, body: String, timeout: Duration) -> Result<String, String> {
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    window
        .with_webview(move |platform| unsafe {
            let webview: &WKWebView = &*(platform.inner() as *const WKWebView);
            let mtm = MainThreadMarker::new().expect("with_webview runs on the main thread");
            let world = WKContentWorld::pageWorld(mtm);
            let script = NSString::from_str(&body);
            let handler = RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
                let out = if !error.is_null() {
                    Err((*error).localizedDescription().to_string())
                } else if result.is_null() {
                    Ok("null".to_string())
                } else {
                    Ok((*(result as *const NSString)).to_string())
                };
                let _ = tx.send(out);
            });
            webview.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                &script,
                None,
                None,
                &world,
                Some(&handler),
            );
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(timeout)
        .map_err(|_| "eval timed out".to_string())?
}

fn snapshot(window: &WebviewWindow, timeout: Duration) -> Result<Vec<u8>, String> {
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    window
        .with_webview(move |platform| unsafe {
            let webview: &WKWebView = &*(platform.inner() as *const WKWebView);
            let mtm = MainThreadMarker::new().expect("with_webview runs on the main thread");
            let config = WKSnapshotConfiguration::new(mtm);
            let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let out = if !error.is_null() {
                    Err((*error).localizedDescription().to_string())
                } else if image.is_null() {
                    Err("snapshot returned no image".to_string())
                } else {
                    png_from_image(&*image)
                };
                let _ = tx.send(out);
            });
            webview.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler);
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(timeout)
        .map_err(|_| "snapshot timed out".to_string())?
}

fn png_from_image(image: &NSImage) -> Result<Vec<u8>, String> {
    let tiff = image
        .TIFFRepresentation()
        .ok_or("image has no TIFF representation")?;
    let rep: Retained<NSBitmapImageRep> =
        NSBitmapImageRep::imageRepWithData(&tiff).ok_or("could not decode snapshot")?;
    let png = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }
    .ok_or("PNG encode failed")?;
    Ok(png.to_vec())
}
