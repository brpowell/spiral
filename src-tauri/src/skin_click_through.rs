use serde::Serialize;
use tauri::WebviewWindow;

/// CSS client coordinates of the OS cursor relative to the skin webview.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct ClientPoint {
    pub x: f64,
    pub y: f64,
    /// `NSEvent.pressedMouseButtons` bitfield (0 when unknown / non-macOS).
    #[serde(default)]
    pub buttons: u32,
}

/// AppKit screen space (bottom-left, points) → CSS client (top-left).
#[cfg(any(target_os = "macos", test))]
pub fn client_point_from_appkit_screen(
    cursor_x: f64,
    cursor_y: f64,
    content_x: f64,
    content_y: f64,
    content_height: f64,
) -> ClientPoint {
    ClientPoint {
        x: cursor_x - content_x,
        y: content_height - (cursor_y - content_y),
        buttons: 0,
    }
}

/// Cursor → CSS client using the same AppKit space as `start_skin_window_drag`.
///
/// Tauri `cursorPosition()` / `innerPosition()` mix `CGDisplay::pixels_high`
/// (physical) with AppKit points and can disagree on a left-of-primary
/// display, so JS poll mapped the cursor outside the viewport.
pub fn cursor_client_point(window: &WebviewWindow) -> Result<ClientPoint, String> {
    #[cfg(target_os = "macos")]
    {
        macos_cursor_client(window)
    }
    #[cfg(not(target_os = "macos"))]
    {
        tauri_cursor_client(window)
    }
}

#[cfg(target_os = "macos")]
fn macos_cursor_client(window: &WebviewWindow) -> Result<ClientPoint, String> {
    use objc2::MainThreadMarker;

    if MainThreadMarker::new().is_some() {
        return macos_cursor_client_now(window);
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let owned = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(macos_cursor_client_now(&owned));
        })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
fn macos_pressed_mouse_buttons() -> u32 {
    use objc2::{class, msg_send};
    let buttons: usize = unsafe { msg_send![class!(NSEvent), pressedMouseButtons] };
    buttons as u32
}

#[cfg(target_os = "macos")]
fn macos_cursor_client_now(window: &WebviewWindow) -> Result<ClientPoint, String> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{NSPoint, NSRect};

    let ptr = window.ns_window().map_err(|e| e.to_string())?;
    if ptr.is_null() {
        return Err("missing ns_window".into());
    }
    let ns_window = ptr.cast::<AnyObject>();
    unsafe {
        let frame: NSRect = msg_send![ns_window, frame];
        let content: NSRect = msg_send![ns_window, contentRectForFrameRect: frame];
        let cursor: NSPoint = msg_send![class!(NSEvent), mouseLocation];
        let mut point = client_point_from_appkit_screen(
            cursor.x,
            cursor.y,
            content.origin.x,
            content.origin.y,
            content.size.height,
        );
        point.buttons = macos_pressed_mouse_buttons();
        Ok(point)
    }
}

#[cfg(not(target_os = "macos"))]
fn tauri_cursor_client(window: &WebviewWindow) -> Result<ClientPoint, String> {
    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    let origin = window.inner_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    Ok(ClientPoint {
        x: (cursor.x - f64::from(origin.x)) / scale,
        y: (cursor.y - f64::from(origin.y)) / scale,
        buttons: 0,
    })
}

/// Toggle OS click-through for a skin window.
///
/// `ignoresMouseEvents` alone is enough: the window server routes the click to
/// whatever is behind the window regardless of key/active status. Do not also
/// resign key or deactivate the app — AppKit then rebuilds focus on the next
/// mouse-down, and that path makes a synchronous accessibility query that
/// blocks the main thread.
pub fn set_ignore_cursor_events(window: &WebviewWindow, ignore: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        set_ignore_macos(window, ignore)
    }
    #[cfg(not(target_os = "macos"))]
    {
        window
            .set_ignore_cursor_events(ignore)
            .map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "macos")]
fn set_ignore_macos(window: &WebviewWindow, ignore: bool) -> Result<(), String> {
    use objc2::MainThreadMarker;

    if MainThreadMarker::new().is_some() {
        apply_macos_ignore(window, ignore);
        return Ok(());
    }

    let window = window.clone();
    window
        .clone()
        .run_on_main_thread(move || apply_macos_ignore(&window, ignore))
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn apply_macos_ignore(window: &WebviewWindow, ignore: bool) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let Ok(ptr) = window.ns_window() else {
        return;
    };
    if ptr.is_null() {
        return;
    }
    let ns_window = ptr.cast::<AnyObject>();
    unsafe {
        let _: () = msg_send![ns_window, setIgnoresMouseEvents: ignore];
    }
}

#[cfg(test)]
mod tests {
    use super::client_point_from_appkit_screen;

    #[test]
    fn appkit_screen_flips_y_into_css_client() {
        let point = client_point_from_appkit_screen(120.0, 180.0, 20.0, 80.0, 400.0);
        assert_eq!(point.x, 100.0);
        assert_eq!(point.y, 300.0);
    }
}
