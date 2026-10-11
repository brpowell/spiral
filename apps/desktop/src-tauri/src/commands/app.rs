use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    // Destroy webviews before process exit so WebView2 can tear down cleanly
    // on Windows (avoids benign Chrome_WidgetWin_0 unregister noise).
    for window in app.webview_windows().into_values() {
        let _ = window.destroy();
    }
    app.exit(0);
}
