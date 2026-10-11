//! App webviews.
//!
//! Created here so each macOS content process can be named, and so only the
//! windows that need to open instantly are booted at launch. Skin and Studio
//! stay resident. Equalizer, Activity Logs, and About are created on open and
//! destroyed on close. Skin aux windows are created on demand and share one
//! process name, since they come and go with skin mode.

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

struct WindowSpec {
    label: &'static str,
    title: &'static str,
    /// Created at launch and hidden on close. Otherwise created on open and destroyed on close.
    preload: bool,
    width: f64,
    height: f64,
    min: Option<(f64, f64)>,
    max: Option<(f64, f64)>,
    visible: bool,
    resizable: bool,
    maximizable: Option<bool>,
    decorations: Option<bool>,
    transparent: bool,
    shadow: Option<bool>,
    drag_drop: bool,
    accept_first_mouse: bool,
    disable_background_throttling: bool,
    /// Windows and Linux draw the custom title bar.
    custom_chrome: bool,
}

const WINDOWS: &[WindowSpec] = &[
    WindowSpec {
        label: "main",
        title: "Spiral",
        preload: true,
        width: 1200.0,
        height: 800.0,
        min: Some((520.0, 420.0)),
        max: None,
        // Shown by the frontend after its first render, so launch never flashes
        // an empty native or webview background.
        visible: false,
        resizable: true,
        maximizable: None,
        decorations: None,
        transparent: false,
        shadow: None,
        drag_drop: true,
        accept_first_mouse: false,
        disable_background_throttling: true,
        custom_chrome: true,
    },
    WindowSpec {
        label: "skin-mode",
        title: "Spiral Skin Mode",
        preload: true,
        width: 320.0,
        height: 440.0,
        min: Some((200.0, 120.0)),
        max: None,
        visible: false,
        resizable: true,
        maximizable: None,
        decorations: Some(false),
        transparent: true,
        shadow: Some(false),
        drag_drop: false,
        accept_first_mouse: true,
        disable_background_throttling: false,
        custom_chrome: false,
    },
    WindowSpec {
        label: "appearance",
        title: "Studio",
        preload: true,
        width: 1000.0,
        height: 720.0,
        min: Some((520.0, 420.0)),
        max: None,
        visible: false,
        resizable: true,
        maximizable: None,
        decorations: None,
        transparent: false,
        shadow: None,
        drag_drop: false,
        accept_first_mouse: false,
        disable_background_throttling: false,
        custom_chrome: true,
    },
    WindowSpec {
        label: "equalizer",
        title: "Equalizer",
        preload: false,
        width: 580.0,
        height: 260.0,
        min: Some((580.0, 260.0)),
        max: Some((580.0, 260.0)),
        visible: false,
        resizable: false,
        maximizable: Some(false),
        decorations: None,
        transparent: false,
        shadow: None,
        drag_drop: false,
        accept_first_mouse: false,
        disable_background_throttling: false,
        custom_chrome: true,
    },
    WindowSpec {
        label: "activity-logs",
        title: "Activity Logs",
        preload: false,
        width: 720.0,
        height: 520.0,
        min: Some((480.0, 320.0)),
        max: None,
        visible: false,
        resizable: true,
        maximizable: None,
        decorations: None,
        transparent: false,
        shadow: None,
        drag_drop: false,
        accept_first_mouse: false,
        disable_background_throttling: false,
        custom_chrome: true,
    },
    WindowSpec {
        label: "about",
        title: "About Spiral",
        preload: false,
        width: 880.0,
        height: 600.0,
        min: None,
        max: None,
        visible: false,
        resizable: false,
        maximizable: None,
        decorations: None,
        transparent: false,
        shadow: None,
        drag_drop: false,
        accept_first_mouse: false,
        disable_background_throttling: false,
        custom_chrome: true,
    },
];

#[derive(Serialize)]
pub struct EnsureAppWindowResult {
    created: bool,
}

fn spec_by_label(label: &str) -> Option<&'static WindowSpec> {
    WINDOWS.iter().find(|spec| spec.label == label)
}

pub fn create_startup_windows(app: &AppHandle) -> Result<(), String> {
    // Main boots alone so it gets the CPU. The other resident webviews are
    // created once main reports ready.
    create_window(app, "main")?;

    use tauri::Listener;
    let handle = app.clone();
    app.once("spiral:window-ready", move |_| {
        // The ready event fires alongside main's show(); wait it out so
        // webview creation doesn't delay the reveal.
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            let handle_for_work = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                for spec in WINDOWS {
                    if spec.preload && spec.label != "main" {
                        if let Err(err) = create_window(&handle_for_work, spec.label) {
                            eprintln!("failed to preload `{}`: {err}", spec.label);
                        }
                    }
                }
            });
        });
    });
    Ok(())
}

#[tauri::command]
pub fn ensure_app_window(app: AppHandle, label: String) -> Result<EnsureAppWindowResult, String> {
    if spec_by_label(&label).is_none() {
        return Err(format!("unknown window `{label}`"));
    }
    if app.get_webview_window(&label).is_some() {
        return Ok(EnsureAppWindowResult { created: false });
    }
    let created_label = label.clone();
    run_on_main(&app, move |app| create_window(app, &created_label))??;
    Ok(EnsureAppWindowResult { created: true })
}

const SKIN_AUX_LABEL_PREFIX: &str = "skin-aux-";
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
const SKIN_HELPER_PROCESS_NAME: &str = "Spiral Skin Helper";

/// Create a skin aux webview. The process name has to be set before the
/// webview exists.
#[tauri::command]
pub fn create_skin_aux_window(
    app: AppHandle,
    label: String,
    title: String,
    skin_id: String,
    view_id: String,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
    max_width: Option<f64>,
    max_height: Option<f64>,
    resizable: bool,
) -> Result<(), String> {
    if !label.starts_with(SKIN_AUX_LABEL_PREFIX) || skin_id.is_empty() || view_id.is_empty() {
        return Err(format!("invalid skin aux window `{label}`"));
    }
    run_on_main(&app, move |app| {
        if app.get_webview_window(&label).is_some() {
            return Ok(());
        }
        let mut builder = WebviewWindowBuilder::new(app, &label, skin_aux_url(&skin_id, &view_id))
            .title(title)
            .inner_size(width, height)
            .min_inner_size(min_width, min_height)
            .visible(false)
            .resizable(resizable)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .disable_drag_drop_handler()
            .accept_first_mouse(true);
        if let (Some(max_width), Some(max_height)) = (max_width, max_height) {
            builder = builder.max_inner_size(max_width, max_height);
        }
        #[cfg(all(feature = "agent-bridge", debug_assertions, target_os = "macos"))]
        {
            builder = builder.initialization_script(crate::agent_bridge::INIT_SCRIPT);
        }
        #[cfg(target_os = "macos")]
        {
            builder = stamp_process_display_name(builder, process_display_name(&label))?;
        }
        builder
            .build()
            .map_err(|err| format!("create `{label}`: {err}"))?;
        Ok(())
    })?
}

/// Hide a preloaded window, or destroy one that is created on demand.
#[tauri::command]
pub fn release_app_window(app: AppHandle, label: String) -> Result<(), String> {
    let preload = spec_by_label(&label)
        .ok_or_else(|| format!("unknown window `{label}`"))?
        .preload;
    run_on_main(&app, move |app| release_window(app, &label, preload))?
}

fn release_window(app: &AppHandle, label: &str, preload: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(label) else {
        return Ok(());
    };
    if preload {
        window.hide().map_err(|err| err.to_string())
    } else {
        window.destroy().map_err(|err| err.to_string())
    }
}

fn create_window(app: &AppHandle, label: &str) -> Result<(), String> {
    let Some(spec) = spec_by_label(label) else {
        return Err(format!("unknown window `{label}`"));
    };
    if app.get_webview_window(label).is_some() {
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(app, spec.label, WebviewUrl::default())
        .title(spec.title)
        .inner_size(spec.width, spec.height)
        .visible(spec.visible)
        .resizable(spec.resizable);

    // Transparent skin windows must not get an opaque backdrop.
    if !spec.transparent {
        builder = builder.background_color(tauri::utils::config::Color(14, 14, 16, 255));
    }

    if let Some((width, height)) = spec.min {
        builder = builder.min_inner_size(width, height);
    }
    if let Some((width, height)) = spec.max {
        builder = builder.max_inner_size(width, height);
    }
    if let Some(maximizable) = spec.maximizable {
        builder = builder.maximizable(maximizable);
    }
    if let Some(decorations) = spec.decorations {
        builder = builder.decorations(decorations);
    }
    if spec.transparent {
        builder = builder.transparent(true);
    }
    if let Some(shadow) = spec.shadow {
        builder = builder.shadow(shadow);
    }
    if !spec.drag_drop {
        builder = builder.disable_drag_drop_handler();
    }
    if spec.accept_first_mouse {
        builder = builder.accept_first_mouse(true);
    }
    if spec.disable_background_throttling {
        builder = builder
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);
    }

    #[cfg(all(feature = "agent-bridge", debug_assertions, target_os = "macos"))]
    {
        builder = builder.initialization_script(crate::agent_bridge::INIT_SCRIPT);
    }

    #[cfg(any(windows, target_os = "linux"))]
    if spec.custom_chrome {
        builder = builder.decorations(false).shadow(true);
    }

    #[cfg(target_os = "macos")]
    {
        builder = stamp_process_display_name(builder, process_display_name(spec.label))?;
        // Overlay keeps traffic lights and lets the webview paint the theme
        // in the title-bar region. Hidden title avoids a second system label.
        if spec.custom_chrome {
            builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);
        }
    }

    let window = builder
        .build()
        .map_err(|err| format!("create `{}`: {err}", spec.label))?;

    // Safety net: if the frontend never reaches first paint, don't leave the
    // app invisible.
    if spec.label == "main" && !spec.visible {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(5));
            if !window.is_visible().unwrap_or(true) {
                let _ = window.show();
            }
        });
    }
    Ok(())
}

#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn process_display_name(label: &str) -> &'static str {
    if label.starts_with(SKIN_AUX_LABEL_PREFIX) {
        return SKIN_HELPER_PROCESS_NAME;
    }
    match label {
        "main" => "Spiral Library",
        "skin-mode" => "Spiral Skin",
        "appearance" => "Spiral Studio",
        "equalizer" => "Spiral Equalizer",
        "activity-logs" => "Spiral Activity Logs",
        "about" => "Spiral About",
        _ => "Spiral",
    }
}

/// App-relative URL. A leading `?` keeps the dev server and packaged origin,
/// matching the query the skin aux page already reads.
fn skin_aux_url(skin_id: &str, view_id: &str) -> WebviewUrl {
    let mut query = String::new();
    append_query_pair(&mut query, "skinAux", "1");
    append_query_pair(&mut query, "skinId", skin_id);
    append_query_pair(&mut query, "viewId", view_id);
    WebviewUrl::App(format!("?{query}").into())
}

fn append_query_pair(query: &mut String, key: &str, value: &str) {
    if !query.is_empty() {
        query.push('&');
    }
    query.push_str(key);
    query.push('=');
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                query.push(byte as char);
            }
            _ => query.push_str(&format!("%{byte:02X}")),
        }
    }
}

#[cfg(target_os = "macos")]
fn stamp_process_display_name<'a, M>(
    builder: WebviewWindowBuilder<'a, tauri::Wry, M>,
    name: &str,
) -> Result<WebviewWindowBuilder<'a, tauri::Wry, M>, String>
where
    M: Manager<tauri::Wry>,
{
    use objc2::runtime::Bool;
    use objc2::{msg_send, MainThreadMarker};
    use objc2_foundation::NSString;
    use objc2_web_kit::WKWebViewConfiguration;

    let mtm = MainThreadMarker::new().ok_or("window creation is off the main thread")?;
    let config = unsafe { WKWebViewConfiguration::new(mtm) };
    let display_name = NSString::from_str(name);
    let selector = objc2::sel!(_setProcessDisplayName:);
    let responds: Bool = unsafe { msg_send![&*config, respondsToSelector: selector] };
    if responds.as_bool() {
        let _: () = unsafe { msg_send![&*config, _setProcessDisplayName: &*display_name] };
    }
    Ok(builder.with_webview_configuration(config))
}

fn run_on_main<T, F>(app: &AppHandle, work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle) -> T + Send + 'static,
{
    #[cfg(target_os = "macos")]
    if objc2::MainThreadMarker::new().is_some() {
        return Ok(work(app));
    }

    let app = app.clone();
    let app_for_work = app.clone();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = tx.send(work(&app_for_work));
    })
    .map_err(|err| format!("main thread: {err}"))?;
    rx.recv()
        .map_err(|err| format!("main thread dropped: {err}"))
}

#[cfg(test)]
mod tests {
    use super::{process_display_name, skin_aux_url, SKIN_HELPER_PROCESS_NAME, WINDOWS};
    use tauri::WebviewUrl;

    #[test]
    fn preloads_library_skin_and_studio() {
        let preloaded: Vec<_> = WINDOWS
            .iter()
            .filter(|spec| spec.preload)
            .map(|spec| spec.label)
            .collect();
        assert_eq!(preloaded, ["main", "skin-mode", "appearance"]);
    }

    #[test]
    fn creates_utility_windows_on_demand() {
        let on_demand: Vec<_> = WINDOWS
            .iter()
            .filter(|spec| !spec.preload)
            .map(|spec| spec.label)
            .collect();
        assert_eq!(on_demand, ["equalizer", "activity-logs", "about"]);
    }

    #[test]
    fn names_every_skin_aux_process_as_a_helper() {
        assert_eq!(
            process_display_name("skin-aux-t3_eq"),
            SKIN_HELPER_PROCESS_NAME
        );
        assert_eq!(
            process_display_name("skin-aux-spiral:xbox:skin:xbox_playlist"),
            SKIN_HELPER_PROCESS_NAME
        );
        assert_eq!(process_display_name("skin-mode"), "Spiral Skin");
    }

    #[test]
    fn skin_aux_url_carries_the_view_query() {
        let WebviewUrl::App(path) = skin_aux_url("spiral.xbox.skin.xbox", "play list") else {
            panic!("expected an app url");
        };
        assert_eq!(
            path.to_str(),
            Some("?skinAux=1&skinId=spiral.xbox.skin.xbox&viewId=play%20list")
        );
    }
}
