use tauri::WebviewWindow;

/// Start a window drag for a skin drag region.
///
/// Tauri's built-in `data-tauri-drag-region` path hands whatever
/// `NSApp.currentEvent` happens to be to `performWindowDragWithEvent:`. Because
/// the request arrives over async IPC, that event is often *not* the mouse
/// event: an AppKit-defined event (window moved, app activated) leaves the drag
/// anchored at the window's top-left corner, so the window snaps to the cursor
/// and can be flung off screen. Skin windows deactivate the app for
/// click-through, which makes those events common.
///
/// Anchoring on the live cursor position instead makes the grab offset exact no
/// matter when the request is serviced.
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
