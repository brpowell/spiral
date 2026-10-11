#![cfg(target_os = "macos")]

use crate::cd::events::MonitorWake;
use crate::cd::platform;
use block2::RcBlock;
use objc2::rc::autoreleasepool;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2_app_kit::{
    NSWorkspace, NSWorkspaceDidMountNotification, NSWorkspaceDidUnmountNotification,
    NSWorkspaceVolumeOldURLKey, NSWorkspaceVolumeURLKey,
};
use objc2_foundation::{NSNotification, NSObjectProtocol, NSOperationQueue, NSURL};
use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::mpsc::Sender;
use std::sync::OnceLock;

type CFStringRef = *const c_void;
type CFRunLoopRef = *mut c_void;
type CFRunLoopSourceRef = *mut c_void;
type DRNotificationCenterRef = *mut c_void;
type DRTypeRef = *mut c_void;
type CFDictionaryRef = *const c_void;

static DEVICE_WAKE_TX: OnceLock<Sender<MonitorWake>> = OnceLock::new();

/// Keeps DRNotificationCenter + run-loop source alive for the process lifetime.
#[allow(dead_code)]
struct DrNotificationHandles {
    center: DRNotificationCenterRef,
    source: CFRunLoopSourceRef,
}

// Created once on the main thread; never accessed after registration.
unsafe impl Send for DrNotificationHandles {}
unsafe impl Sync for DrNotificationHandles {}

static DR_NOTIFICATION_STATE: OnceLock<DrNotificationHandles> = OnceLock::new();

#[link(name = "DiscRecording", kind = "framework")]
extern "C" {
    static DRDeviceStatusChangedNotification: *mut AnyObject;
    fn DRNotificationCenterCreate() -> DRNotificationCenterRef;
    fn DRNotificationCenterCreateRunLoopSource(
        center: DRNotificationCenterRef,
    ) -> CFRunLoopSourceRef;
    fn DRNotificationCenterAddObserver(
        center: DRNotificationCenterRef,
        observer: *const c_void,
        callback: Option<
            unsafe extern "C" fn(
                DRNotificationCenterRef,
                *mut c_void,
                CFStringRef,
                DRTypeRef,
                CFDictionaryRef,
            ),
        >,
        name: CFStringRef,
        object: DRTypeRef,
    );
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRunLoopGetMain() -> CFRunLoopRef;
    fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFStringRef);
    static kCFRunLoopDefaultMode: CFStringRef;
}

unsafe extern "C" fn device_status_changed(
    _center: DRNotificationCenterRef,
    _observer: *mut c_void,
    _name: CFStringRef,
    _object: DRTypeRef,
    _info: CFDictionaryRef,
) {
    if let Some(tx) = DEVICE_WAKE_TX.get() {
        let _ = tx.send(MonitorWake::DeviceStatusChanged);
    }
}

fn register_device_status_observer(tx: Sender<MonitorWake>) {
    DEVICE_WAKE_TX.set(tx).ok();

    unsafe {
        let center = DRNotificationCenterCreate();
        if center.is_null() {
            eprintln!("cd monitor: DRNotificationCenterCreate failed");
            return;
        }

        let name = DRDeviceStatusChangedNotification.cast::<c_void>();
        DRNotificationCenterAddObserver(
            center,
            std::ptr::from_ref(&center).cast(),
            Some(device_status_changed),
            name,
            std::ptr::null_mut(),
        );

        let source = DRNotificationCenterCreateRunLoopSource(center);
        if source.is_null() {
            eprintln!("cd monitor: DRNotificationCenterCreateRunLoopSource failed");
            return;
        }

        CFRunLoopAddSource(CFRunLoopGetMain(), source, kCFRunLoopDefaultMode);
        let _ = DR_NOTIFICATION_STATE.set(DrNotificationHandles { center, source });
    }
}

fn volume_path_from_notification(notification: &NSNotification, mount: bool) -> Option<String> {
    let user_info = notification.userInfo()?;
    let key = unsafe {
        if mount {
            &*NSWorkspaceVolumeURLKey
        } else {
            &*NSWorkspaceVolumeOldURLKey
        }
    };
    let value = user_info.objectForKey(key)?;
    let url = value.downcast::<NSURL>().ok()?;
    url.path().map(|path| path.to_string())
}

fn register_volume_observer(
    center: &objc2_foundation::NSNotificationCenter,
    name: &'static objc2_foundation::NSNotificationName,
    tx: Sender<MonitorWake>,
    mount: bool,
) -> Retained<ProtocolObject<dyn NSObjectProtocol>> {
    let main_queue = NSOperationQueue::mainQueue();
    let block = RcBlock::new(move |notification: NonNull<NSNotification>| {
        let notification = unsafe { notification.as_ref() };
        let Some(path) = volume_path_from_notification(notification, mount) else {
            return;
        };
        if mount && !platform::is_optical_disc_volume(&path) {
            return;
        }
        let wake = if mount {
            MonitorWake::VolumeMounted { path }
        } else {
            MonitorWake::VolumeUnmounted { path }
        };
        let _ = tx.send(wake);
    });

    unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(name),
            None,
            Some(&main_queue),
            &block,
        )
    }
}

/// Register NSWorkspace mount/unmount observers. Call from the main thread during app setup.
pub fn start_volume_events(tx: Sender<MonitorWake>) -> Result<(), String> {
    autoreleasepool(|_| {
        let workspace = NSWorkspace::sharedWorkspace();
        let center = workspace.notificationCenter();

        let mut observers: Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>> = Vec::new();
        observers.push(register_volume_observer(
            &center,
            unsafe { &*NSWorkspaceDidMountNotification },
            tx.clone(),
            true,
        ));
        observers.push(register_volume_observer(
            &center,
            unsafe { &*NSWorkspaceDidUnmountNotification },
            tx.clone(),
            false,
        ));

        // Keep observers alive for the lifetime of the process.
        std::mem::forget(observers);

        register_device_status_observer(tx);
    });

    Ok(())
}
