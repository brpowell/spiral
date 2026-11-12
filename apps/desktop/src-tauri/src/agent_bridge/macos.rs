//! macOS backend: WKWebView for eval and snapshots, `screencapture` for the
//! native window capture.

use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
use objc2_foundation::{NSDictionary, NSError, NSString};
use objc2_web_kit::{WKContentWorld, WKSnapshotConfiguration, WKWebView};
use serde_json::{json, Value};
use tauri::WebviewWindow;

/// Native capture of the whole window (traffic lights, rounded corners and the
/// drop shadow) via `screencapture -l`, the same look as the marketing shots.
/// Needs the Screen Recording permission for the process that launched the app.
pub fn capture(window: &WebviewWindow, out: PathBuf, timeout: Duration) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel::<Result<isize, String>>();
    window
        .with_webview(move |platform| unsafe {
            let ns_window = &*(platform.ns_window() as *const objc2_app_kit::NSWindow);
            let _ = tx.send(Ok(ns_window.windowNumber()));
        })
        .map_err(|e| e.to_string())?;
    let number = rx
        .recv_timeout(timeout)
        .map_err(|_| "window id timed out")??;
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(&out);
    let output = std::process::Command::new("/usr/sbin/screencapture")
        .arg("-x")
        .arg(format!("-l{number}"))
        .arg(&out)
        .output()
        .map_err(|e| format!("screencapture: {e}"))?;
    if !output.status.success() || !out.exists() {
        return Err(format!(
            "screencapture failed ({}): {}. Grant Screen Recording to the app that launched `npm run dev:agent` (System Settings > Privacy & Security).",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(json!({ "path": out }))
}

pub fn eval(window: &WebviewWindow, body: String, timeout: Duration) -> Result<String, String> {
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

pub fn snapshot(window: &WebviewWindow, timeout: Duration) -> Result<Vec<u8>, String> {
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
