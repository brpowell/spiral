//! Keep activation clicks off the accessibility hang.
//!
//! AppKit's mouse-down handler asks HIToolbox for
//! `AXUIElementGetFocusedUIElementBounds`. That is a synchronous accessibility
//! request, and an app answers its own accessibility requests on the main run
//! loop — the same thread making the request from
//! `-[NSWindow _handleMouseDownEvent:]`. A cache miss therefore cannot be
//! serviced and burns the default ~1.5s timeout.
//!
//! Two measures:
//! - Issue that same query from a background thread so the main run loop can
//!   answer, then re-issue it after resign-active (hole clicks deactivate the
//!   app, and the cache does not survive that).
//! - Cap the system-wide messaging timeout so a miss is a stutter, not a hang.

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;
    use std::ptr;
    use std::sync::OnceLock;

    type CFTypeRef = *const c_void;
    type AXUIElementRef = *const c_void;
    type CFStringRef = *const c_void;
    type AXError = i32;

    /// Fast-fail for the shared system-wide element. HIToolbox's mouse-down
    /// observer uses that path. `0` is documented as "use the default" (~1.5s),
    /// so this is the smallest value that still overrides it.
    const SYSTEM_WIDE_TIMEOUT_SECS: f32 = 0.001;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementSetMessagingTimeout(
            element: AXUIElementRef,
            timeout_in_seconds: f32,
        ) -> AXError;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(cf: CFTypeRef);
    }

    /// Process-lifetime system-wide element so a shortened timeout sticks.
    fn system_wide() -> AXUIElementRef {
        static SYSTEM: OnceLock<usize> = OnceLock::new();
        let element = (*SYSTEM.get_or_init(|| unsafe { AXUIElementCreateSystemWide() } as usize))
            as AXUIElementRef;
        if !element.is_null() {
            unsafe {
                AXUIElementSetMessagingTimeout(element, SYSTEM_WIDE_TIMEOUT_SECS);
            }
        }
        element
    }

    fn copy_attribute(element: AXUIElementRef, attribute: &str) -> CFTypeRef {
        use objc2_foundation::NSString;

        let key = NSString::from_str(attribute);
        let key_ref: CFStringRef = (&*key as *const NSString).cast();
        let mut value: CFTypeRef = ptr::null();
        let _ = unsafe { AXUIElementCopyAttributeValue(element, key_ref, &mut value) };
        value
    }

    fn touch(element: AXUIElementRef, attribute: &str) {
        let value = copy_attribute(element, attribute);
        if !value.is_null() {
            unsafe { CFRelease(value) };
        }
    }

    /// Mirror `AXUIElementGetFocusedUIElementBounds`: focused element through
    /// the system-wide element, then its position and size.
    fn warm() {
        std::thread::spawn(|| {
            let system = system_wide();
            if system.is_null() {
                return;
            }
            let focused = copy_attribute(system, "AXFocusedUIElement");
            if focused.is_null() {
                return;
            }
            touch(focused, "AXPosition");
            touch(focused, "AXSize");
            unsafe { CFRelease(focused) };
        });
    }

    pub fn install() {
        use block2::RcBlock;
        use objc2_app_kit::NSApplicationDidResignActiveNotification;
        use objc2_foundation::{NSNotification, NSNotificationCenter};
        use std::ptr::NonNull;
        use std::sync::Once;

        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            // Create the singleton on the main thread so HIToolbox shares it.
            let _ = system_wide();
            let center = NSNotificationCenter::defaultCenter();
            let block = RcBlock::new(|_notification: NonNull<NSNotification>| {
                warm();
            });
            let observer = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(&*NSApplicationDidResignActiveNotification),
                    None,
                    None,
                    &block,
                )
            };
            std::mem::forget(observer);
            warm();
        });
    }
}

/// Install the timeout, warm once, and re-warm after resign-active.
pub fn install() {
    #[cfg(target_os = "macos")]
    imp::install();
}
