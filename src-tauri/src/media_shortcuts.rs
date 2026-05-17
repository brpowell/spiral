use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

const MEDIA_PLAY_PAUSE: &str = "media-play-pause";
const MEDIA_NEXT: &str = "media-next";
const MEDIA_PREV: &str = "media-prev";
const MEDIA_SCRUB_PRESS: &str = "media-scrub-press";
const MEDIA_SCRUB_RELEASE: &str = "media-scrub-release";

#[derive(Clone, Serialize)]
struct MediaScrubPayload {
    direction: &'static str,
}

pub fn register(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let play_pause = Shortcut::new(None, Code::MediaPlayPause);
    let next = Shortcut::new(None, Code::MediaTrackNext);
    let prev = Shortcut::new(None, Code::MediaTrackPrevious);
    let seek_forward = Shortcut::new(None, Code::MediaFastForward);
    let seek_back = Shortcut::new(None, Code::MediaRewind);

    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler({
                let play_pause = play_pause.clone();
                let next = next.clone();
                let prev = prev.clone();
                let seek_forward = seek_forward.clone();
                let seek_back = seek_back.clone();

                move |app, shortcut, event| {
                    let pressed = event.state() == ShortcutState::Pressed;

                    if shortcut == &seek_forward || shortcut == &seek_back {
                        let direction = if shortcut == &seek_forward {
                            "forward"
                        } else {
                            "back"
                        };
                        let event_name = if pressed {
                            MEDIA_SCRUB_PRESS
                        } else {
                            MEDIA_SCRUB_RELEASE
                        };
                        let _ = app.emit(event_name, MediaScrubPayload { direction });
                        return;
                    }

                    if !pressed {
                        return;
                    }

                    let event_name = if shortcut == &play_pause {
                        MEDIA_PLAY_PAUSE
                    } else if shortcut == &next {
                        MEDIA_NEXT
                    } else if shortcut == &prev {
                        MEDIA_PREV
                    } else {
                        return;
                    };

                    let _ = app.emit(event_name, ());
                }
            })
            .build(),
    )?;

    let shortcuts = app.global_shortcut();
    shortcuts.register(play_pause)?;
    shortcuts.register(next)?;
    shortcuts.register(prev)?;
    shortcuts.register(seek_forward)?;
    shortcuts.register(seek_back)?;

    Ok(())
}
