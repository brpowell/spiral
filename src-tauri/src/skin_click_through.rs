use tauri::WebviewWindow;

/// Toggle OS click-through for a skin window.
///
/// On macOS a *key* / active app still receives clicks even with
/// `ignoresMouseEvents` set (`resignKeyWindow` is a no-op if called directly).
/// Deactivate the app so the hardware click goes to whatever is behind the
/// skin. Windows and Linux only need the usual ignore-cursor flag.
pub fn set_ignore_cursor_events(
    window: &WebviewWindow,
    ignore: bool,
) -> Result<(), String> {
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
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;

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
    if ignore {
        if let Some(mtm) = MainThreadMarker::new() {
            NSApplication::sharedApplication(mtm).deactivate();
        }
    }
}
