//! System sleep/wake notifications for the output stage.

use super::output::AudioOutput;

/// Forward OS sleep/wake to `output`. macOS only; other platforms recover
/// through stream errors and the callback watchdog instead.
#[cfg(target_os = "macos")]
pub fn watch_power_events(output: AudioOutput) {
    use block2::RcBlock;
    use objc2::rc::{autoreleasepool, Retained};
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{
        NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceWillSleepNotification,
    };
    use objc2_foundation::{NSNotification, NSNotificationName, NSObjectProtocol};
    use std::ptr::NonNull;

    fn observe(
        center: &objc2_foundation::NSNotificationCenter,
        name: &'static NSNotificationName,
        handler: impl Fn() + 'static,
    ) -> Retained<ProtocolObject<dyn NSObjectProtocol>> {
        // `None` queue delivers synchronously on the posting thread; the handler
        // only sends on a channel, so that is safe and avoids depending on the
        // main run loop being responsive right at wake.
        let block = RcBlock::new(move |_: NonNull<NSNotification>| handler());
        unsafe { center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block) }
    }

    autoreleasepool(|_| {
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        let sleep_output = output.clone();
        let sleep = observe(
            &center,
            unsafe { NSWorkspaceWillSleepNotification },
            move || sleep_output.notify_will_sleep(),
        );
        let wake = observe(
            &center,
            unsafe { NSWorkspaceDidWakeNotification },
            move || output.notify_did_wake(),
        );
        // Observers live for the process lifetime.
        std::mem::forget(sleep);
        std::mem::forget(wake);
    });
}

#[cfg(not(target_os = "macos"))]
pub fn watch_power_events(_output: AudioOutput) {}
