//! Hold-to-scrub for the Fast Forward / Rewind media keys on macOS.
//!
//! macOS delivers a held F7/F9 key to the Now Playing app as a begin-seeking
//! command followed by an end-seeking command on `MPRemoteCommandCenter`. This
//! is the same route as play/pause and track skipping, so it needs no
//! Accessibility permission (unlike watching raw key events with an event
//! tap). `souvlaki` doesn't register these two commands, so they are added here
//! next to its handlers.

#[cfg(target_os = "macos")]
mod imp {
    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use serde::Serialize;
    use tauri::{AppHandle, Emitter};

    /// `MPSeekCommandEventTypeBeginSeeking` / `EndSeeking`.
    const SEEK_BEGIN: usize = 0;
    const SEEK_END: usize = 1;
    /// `MPRemoteCommandHandlerStatusSuccess`.
    const STATUS_SUCCESS: isize = 0;

    #[derive(Clone, Serialize)]
    struct ScrubPayload {
        direction: &'static str,
    }

    fn handler(
        app: &AppHandle,
        direction: &'static str,
    ) -> RcBlock<dyn Fn(*mut AnyObject) -> isize> {
        let app = app.clone();
        RcBlock::new(move |event: *mut AnyObject| -> isize {
            if event.is_null() {
                return STATUS_SUCCESS;
            }
            // SAFETY: the system passes an `MPSeekCommandEvent`, which has a
            // `type` property returning an `NSUInteger`.
            let kind: usize = unsafe { msg_send![event, type] };
            let name = match kind {
                SEEK_BEGIN => "media-scrub-begin",
                SEEK_END => "media-scrub-end",
                _ => return STATUS_SUCCESS,
            };
            let _ = app.emit(name, ScrubPayload { direction });
            STATUS_SUCCESS
        })
    }

    pub fn register(app: &AppHandle) {
        let Some(center_class) = AnyClass::get(c"MPRemoteCommandCenter") else {
            eprintln!("media seek commands unavailable: MediaPlayer not loaded");
            return;
        };

        // SAFETY: plain Objective-C calls on the shared command center and its
        // two seek commands; the handler blocks are retained by the commands.
        unsafe {
            let center: Retained<AnyObject> = msg_send![center_class, sharedCommandCenter];

            let forward: Retained<AnyObject> = msg_send![&*center, seekForwardCommand];
            let _: () = msg_send![&*forward, setEnabled: true];
            let block = handler(app, "forward");
            let _: Retained<AnyObject> = msg_send![&*forward, addTargetWithHandler: &*block];

            let backward: Retained<AnyObject> = msg_send![&*center, seekBackwardCommand];
            let _: () = msg_send![&*backward, setEnabled: true];
            let block = handler(app, "back");
            let _: Retained<AnyObject> = msg_send![&*backward, addTargetWithHandler: &*block];
        }
    }
}

/// Register the begin/end seek commands. No-op outside macOS.
pub fn register(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    imp::register(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}
