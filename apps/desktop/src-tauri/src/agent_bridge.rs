//! Dev-only agent bridge: lets a coding agent drive the running app.
//!
//! A private Unix socket (`$XDG_RUNTIME_DIR/spiral-agent.sock`, else
//! `$TMPDIR/spiral-agent.sock`; mode 0600) speaks one
//! JSON object per line. `scripts/agent.mjs` is the client. Commands:
//!
//! * `windows`                      — list window labels + visibility
//! * `show {window}`                — show + focus a (possibly hidden) window
//! * `eval {window, body}`          — run an async JS function body in the page
//!   world; the returned value comes back as JSON
//! * `shot {window}`                — PNG snapshot of the webview (base64)
//! * `geometry {window}`            — inner size, outer position, scale factor
//! * `set_geometry {window, width?, height?, x?, y?}`
//!   — resize (inner, logical points) / move
//! * `capture {window, out}`        — native window capture (frame + shadow, 2x)
//!   written to the absolute path `out`
//!
//! Compiled only with `--features agent-bridge` in a debug build on macOS or
//! Linux (WKWebView / WebKitGTK; `capture` is macOS-only); the
//! cfg guard lives at every call site so none of this can reach a release.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewWindow};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "macos")]
use macos as platform;

/// Console/error buffer injected into every window the bridge can reach.
pub const INIT_SCRIPT: &str = include_str!("agent_bridge.js");

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(15);

pub fn socket_path() -> PathBuf {
    runtime_dir(std::env::var_os("XDG_RUNTIME_DIR")).join("spiral-agent.sock")
}

/// Per-user folder for the socket: `$XDG_RUNTIME_DIR` (private, 0700) on Linux,
/// else the temp dir (already per user on macOS). Keeps the socket out of a
/// shared `/tmp` where another user could plant one first. Must match
/// `runtimeDir` in scripts/lib/agentClient.mjs.
fn runtime_dir(xdg_runtime_dir: Option<std::ffi::OsString>) -> PathBuf {
    xdg_runtime_dir
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
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
            let json_text = platform::eval(&window, wrap_body(body), timeout)?;
            let value: Value = serde_json::from_str(&json_text).map_err(|e| e.to_string())?;
            if let Some(err) = value.get("__agentError").and_then(Value::as_str) {
                return Err(err.to_string());
            }
            Ok(json!({ "value": value }))
        }
        "shot" => {
            let png = platform::snapshot(&window, timeout)?;
            let png = base64::engine::general_purpose::STANDARD.encode(png);
            Ok(json!({ "png": png }))
        }
        "geometry" => geometry(&window),
        "set_geometry" => set_geometry(&window, request),
        "capture" => {
            let out = request["out"].as_str().ok_or("missing `out`")?;
            platform::capture(&window, PathBuf::from(out), timeout)
        }
        other => Err(format!("unknown cmd `{other}`")),
    }
}

fn geometry(window: &WebviewWindow) -> Result<Value, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let inner = window.inner_size().map_err(|e| e.to_string())?;
    let outer = window.outer_size().map_err(|e| e.to_string())?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    Ok(json!({
        "scale": scale,
        "inner": [inner.width as f64 / scale, inner.height as f64 / scale],
        "outer": [outer.width as f64 / scale, outer.height as f64 / scale],
        "position": [position.x as f64 / scale, position.y as f64 / scale],
    }))
}

fn set_geometry(window: &WebviewWindow, request: &Value) -> Result<Value, String> {
    if let (Some(width), Some(height)) = (request["width"].as_f64(), request["height"].as_f64()) {
        window
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
    }
    if let (Some(x), Some(y)) = (request["x"].as_f64(), request["y"].as_f64()) {
        window
            .set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    geometry(window)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_dir_prefers_xdg_runtime_dir() {
        assert_eq!(
            runtime_dir(Some("/run/user/1000".into())),
            PathBuf::from("/run/user/1000")
        );
    }

    #[test]
    fn runtime_dir_falls_back_to_temp_dir() {
        assert_eq!(runtime_dir(None), std::env::temp_dir());
        assert_eq!(runtime_dir(Some("".into())), std::env::temp_dir());
    }
}
