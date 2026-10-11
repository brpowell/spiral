use tauri::WebviewWindow;

/// Start a window drag for a skin drag region.
///
/// Tauri's built-in `data-tauri-drag-region` path hands whatever
/// `NSApp.currentEvent` happens to be to `performWindowDragWithEvent:`. Because
/// the request arrives over async IPC, that event is often *not* the mouse
/// event: an AppKit-defined event (window moved, app activated) leaves the drag
/// anchored at the window's top-left corner, so the window snaps to the cursor
/// and can be flung off screen.
///
/// Anchoring on the live cursor position makes the grab offset exact when the
/// request is serviced promptly. IPC can still arrive after the press has
/// ended or left the window — refuse that stale drag so the skin does not
/// teleport.
pub fn start_drag(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;

        if MainThreadMarker::new().is_some() {
            start_drag_macos(window);
            return Ok(());
        }
        let owned = window.clone();
        window
            .clone()
            .run_on_main_thread(move || start_drag_macos(&owned))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.start_dragging().map_err(|e| e.to_string())
    }
}

/// AppKit screen point vs window frame (bottom-left origin).
#[cfg(any(target_os = "macos", test))]
pub(crate) fn appkit_point_in_rect(
    x: f64,
    y: f64,
    origin_x: f64,
    origin_y: f64,
    width: f64,
    height: f64,
) -> bool {
    x >= origin_x && y >= origin_y && x < origin_x + width && y < origin_y + height
}

/// A delayed drag IPC must not start after the press has ended or left the window.
#[cfg(any(target_os = "macos", test))]
pub(crate) fn should_begin_window_drag(left_button_down: bool, cursor_in_frame: bool) -> bool {
    left_button_down && cursor_in_frame
}

#[cfg(target_os = "macos")]
fn start_drag_macos(window: &WebviewWindow) {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{NSPoint, NSRect};

    const NS_EVENT_TYPE_LEFT_MOUSE_DOWN: usize = 1;

    let Ok(ptr) = window.ns_window() else {
        return;
    };
    if ptr.is_null() {
        return;
    }
    let ns_window = ptr.cast::<AnyObject>();

    unsafe {
        let frame: NSRect = msg_send![ns_window, frame];
        let window_number: isize = msg_send![ns_window, windowNumber];
        let cursor: NSPoint = msg_send![class!(NSEvent), mouseLocation];
        let buttons: usize = msg_send![class!(NSEvent), pressedMouseButtons];
        let left_down = buttons & 1 != 0;
        let in_frame = appkit_point_in_rect(
            cursor.x,
            cursor.y,
            frame.origin.x,
            frame.origin.y,
            frame.size.width,
            frame.size.height,
        );
        if !should_begin_window_drag(left_down, in_frame) {
            return;
        }

        // Screen and window coordinates share a bottom-left origin.
        let location = NSPoint::new(cursor.x - frame.origin.x, cursor.y - frame.origin.y);

        let event: *mut AnyObject = msg_send![
            class!(NSEvent),
            mouseEventWithType: NS_EVENT_TYPE_LEFT_MOUSE_DOWN,
            location: location,
            modifierFlags: 0usize,
            timestamp: 0f64,
            windowNumber: window_number,
            context: std::ptr::null_mut::<AnyObject>(),
            eventNumber: 0isize,
            clickCount: 1isize,
            pressure: 1f32,
        ];
        if event.is_null() {
            return;
        }
        let _: () = msg_send![ns_window, performWindowDragWithEvent: event];
    }
}

#[cfg(test)]
mod tests {
    use super::{appkit_point_in_rect, should_begin_window_drag};

    #[test]
    fn point_inside_frame() {
        assert!(appkit_point_in_rect(50.0, 80.0, 10.0, 20.0, 100.0, 200.0));
        assert!(!appkit_point_in_rect(5.0, 80.0, 10.0, 20.0, 100.0, 200.0));
        assert!(!appkit_point_in_rect(50.0, 10.0, 10.0, 20.0, 100.0, 200.0));
    }

    #[test]
    fn stale_drag_after_release_or_leave_is_refused() {
        assert!(!should_begin_window_drag(false, true));
        assert!(!should_begin_window_drag(true, false));
        assert!(!should_begin_window_drag(false, false));
        assert!(should_begin_window_drag(true, true));
    }
}
