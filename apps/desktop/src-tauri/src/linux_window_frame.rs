//! Shadow, rounded corners and an outer resize border for custom-chrome
//! windows on Linux.
//!
//! The app draws its own title bar, so these windows must not get a native
//! one. Turning decorations off (`decorations(false)`) does that, but also
//! leaves a bare rectangle: no shadow, square corners, and resizing only from
//! the 5px strip tauri-runtime-wry watches inside the webview edge.
//!
//! GTK's client-side decorations already draw a shadow and put the resize
//! handles in it, outside the content. So instead of switching decorations
//! off, keep them on and give GTK an empty titlebar: it draws the frame
//! around the webview and nothing above it. The webview background is cleared
//! so the page can round its own corners to match the frame (`windowFrame.ts`,
//! `CustomWindowFrame.css`); GTK reports maximized, tiled and fullscreen
//! states, where the page squares them again.

use gtk::gdk::WindowState;
use gtk::prelude::*;
use tauri::{Emitter, Runtime, WebviewWindow};

use crate::app_windows::WindowFrame;

/// Style class GTK CSS uses to find our windows.
const FRAME_CLASS: &str = "spiral-window-frame";

/// Event telling the page whether to round its corners.
pub const FRAME_EVENT: &str = "spiral:window-frame";

/// Radius matches `--window-frame-radius` in `CustomWindowFrame.css`.
const CSS: &str = r#"
window.spiral-window-frame {
  background-color: transparent;
}

window.spiral-window-frame > .titlebar {
  min-height: 0;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  box-shadow: none;
}

window.spiral-window-frame decoration {
  border-radius: 10px;
  margin: 12px;
  box-shadow:
    0 6px 18px 2px rgba(0, 0, 0, 0.42),
    0 1px 4px 0 rgba(0, 0, 0, 0.30),
    0 0 0 1px rgba(0, 0, 0, 0.45);
}

window.spiral-window-frame decoration:backdrop {
  box-shadow:
    0 3px 10px 1px rgba(0, 0, 0, 0.28),
    0 0 0 1px rgba(0, 0, 0, 0.35);
}

window.spiral-window-frame.maximized decoration,
window.spiral-window-frame.fullscreen decoration {
  border-radius: 0;
  box-shadow: none;
}

/* Tiled edges touch the screen or a neighbour: square, no shadow, but keep a
   transparent spread so the free edges stay resizable. */
window.spiral-window-frame.tiled decoration,
window.spiral-window-frame.tiled-top decoration,
window.spiral-window-frame.tiled-right decoration,
window.spiral-window-frame.tiled-bottom decoration,
window.spiral-window-frame.tiled-left decoration {
  border-radius: 0;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35), 0 0 0 12px transparent;
}
"#;

/// Corners stay square whenever an edge meets the screen or another window.
fn rounded_for(state: WindowState) -> bool {
    !state.intersects(
        WindowState::MAXIMIZED
            | WindowState::FULLSCREEN
            | WindowState::TILED
            | WindowState::TOP_TILED
            | WindowState::RIGHT_TILED
            | WindowState::BOTTOM_TILED
            | WindowState::LEFT_TILED,
    )
}

fn install_css(window: &gtk::ApplicationWindow) {
    thread_local! {
        static INSTALLED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    }
    if INSTALLED.with(|done| done.replace(true)) {
        return;
    }
    let Some(screen) = GtkWindowExt::screen(window) else {
        INSTALLED.with(|done| done.set(false));
        return;
    };
    let provider = gtk::CssProvider::new();
    if let Err(err) = provider.load_from_data(CSS.as_bytes()) {
        eprintln!("window frame css: {err}");
        return;
    }
    // USER beats tao's APPLICATION-priority `background_color` provider.
    gtk::StyleContext::add_provider_for_screen(
        &screen,
        &provider,
        gtk::STYLE_PROVIDER_PRIORITY_USER,
    );
}

/// Give `window` the GTK frame. Idempotent. Must run on the main thread and,
/// the first time, before the window is first shown: GTK only accepts a
/// titlebar before it creates the native window. A window that is already
/// realized without one keeps the plain undecorated look.
pub fn apply<R: Runtime>(window: &WebviewWindow<R>) -> WindowFrame {
    let Ok(gtk_window) = window.gtk_window() else {
        return WindowFrame::NONE;
    };
    let style = gtk_window.style_context();
    if style.has_class(FRAME_CLASS) {
        return current(&gtk_window);
    }
    if gtk_window.is_realized() {
        gtk_window.set_decorated(false);
        return WindowFrame::NONE;
    }

    install_css(&gtk_window);
    style.add_class(FRAME_CLASS);
    // On Wayland tao has already set an EventBox titlebar; replace it so X11
    // and Wayland end up the same. A Box draws nothing and takes no input.
    let titlebar = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    gtk_window.set_titlebar(Some(&titlebar));
    gtk_window.set_decorated(true);

    let _ = window.with_webview(|webview| {
        use webkit2gtk::WebViewExt;
        webview
            .inner()
            .set_background_color(&gtk::gdk::RGBA::new(0.0, 0.0, 0.0, 0.0));
    });

    let emitter = window.clone();
    let last = std::cell::Cell::new(None);
    gtk_window.connect_window_state_event(move |_, event| {
        let rounded = rounded_for(event.new_window_state());
        if last.replace(Some(rounded)) != Some(rounded) {
            let _ = emitter.emit_to(emitter.label(), FRAME_EVENT, rounded);
        }
        gtk::glib::Propagation::Proceed
    });

    current(&gtk_window)
}

fn current(gtk_window: &gtk::ApplicationWindow) -> WindowFrame {
    let state = gtk_window
        .window()
        .map(|gdk_window| gdk_window.state())
        .unwrap_or_else(WindowState::empty);
    WindowFrame {
        enabled: true,
        rounded: rounded_for(state),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floating_window_is_rounded() {
        assert!(rounded_for(WindowState::empty()));
        assert!(rounded_for(WindowState::FOCUSED));
    }

    #[test]
    fn edge_states_are_square() {
        for state in [
            WindowState::MAXIMIZED,
            WindowState::FULLSCREEN,
            WindowState::TILED,
            WindowState::LEFT_TILED | WindowState::FOCUSED,
            WindowState::TOP_TILED,
        ] {
            assert!(!rounded_for(state), "{state:?}");
        }
    }
}
