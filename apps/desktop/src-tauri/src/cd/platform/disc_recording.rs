//! In-process DiscRecording (DRDevice) access via objc2.
#![cfg(target_os = "macos")]
#![allow(non_snake_case)]

#[path = "cd_text.rs"]
mod cd_text;

pub use cd_text::{read_cdtext, CdTextData};

use objc2::exception::catch;
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::AnyObject;
use objc2::{extern_class, extern_methods};
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSObject, NSString};
use std::panic::AssertUnwindSafe;

extern_class!(
    #[unsafe(super(NSObject))]
    #[name = "DRDevice"]
    pub struct DRDevice;
);

impl DRDevice {
    extern_methods!(
        #[unsafe(method(devices))]
        pub fn devices() -> Retained<NSArray<DRDevice>>;

        #[unsafe(method(isValid))]
        pub fn isValid(&self) -> bool;

        #[unsafe(method(displayName))]
        pub fn displayName(&self) -> Retained<NSString>;

        #[unsafe(method(status))]
        pub fn status(&self) -> Retained<NSDictionary>;

        #[unsafe(method(mediaIsPresent))]
        pub fn mediaIsPresent(&self) -> bool;

        #[unsafe(method(mediaIsTransitioning))]
        pub fn mediaIsTransitioning(&self) -> bool;

        #[unsafe(method(mediaType))]
        pub fn mediaType(&self) -> Option<Retained<NSString>>;

        #[unsafe(method(ejectMedia))]
        pub fn ejectMedia(&self) -> bool;

        #[unsafe(method(bsdName))]
        pub fn bsdName(&self) -> Option<Retained<NSString>>;
    );
}

extern_class!(
    #[unsafe(super(NSObject))]
    #[name = "DRTrack"]
    pub struct DRTrack;
);

impl DRTrack {
    extern_methods!(
        #[unsafe(method(properties))]
        pub fn properties(&self) -> Retained<NSDictionary>;
    );
}

extern_class!(
    #[unsafe(super(NSNumber))]
    #[name = "DRMSF"]
    pub struct DRMSF;
);

impl DRMSF {
    extern_methods!(
        #[unsafe(method(sectors))]
        pub fn sectors(&self) -> u32;
    );
}

#[link(name = "DiscRecording", kind = "framework")]
extern "C" {
    static DRDeviceTrackRefsKey: *mut AnyObject;
    static DRDeviceTrackInfoKey: *mut AnyObject;
    static DRDeviceMediaInfoKey: *mut AnyObject;
    static DRDeviceMediaClassKey: *mut AnyObject;
    static DRDeviceMediaTypeKey: *mut AnyObject;
    static DRDeviceMediaTrackCountKey: *mut AnyObject;
    static DRDeviceMediaSessionCountKey: *mut AnyObject;
    static DRTrackNumberKey: *mut AnyObject;
    static DRTrackLengthKey: *mut AnyObject;
    static DRTrackModeKey: *mut AnyObject;
    static DRSessionNumberKey: *mut AnyObject;
}

fn ns_key(ptr: *mut AnyObject) -> &'static NSString {
    unsafe { &*ptr.cast() }
}

/// DiscRecording throws NSExceptions on concurrent access and some error paths.
fn catch_dr<T>(label: &str, f: impl FnOnce() -> T) -> Option<T> {
    match catch(AssertUnwindSafe(f)) {
        Ok(value) => Some(value),
        Err(Some(exception)) => {
            eprintln!("DiscRecording {label} exception: {exception}");
            None
        }
        Err(None) => {
            eprintln!("DiscRecording {label} exception: (nil)");
            None
        }
    }
}

fn ns_string(obj: &AnyObject) -> Option<String> {
    obj.downcast_ref::<NSString>().map(|s| s.to_string())
}

fn ns_u32(obj: &AnyObject) -> Option<u32> {
    obj.downcast_ref::<NSNumber>().map(|n| n.as_u32())
}

unsafe fn dict_string(dict: &NSDictionary, key: *mut AnyObject) -> Option<String> {
    dict.objectForKey(ns_key(key))
        .and_then(|obj| ns_string(&obj))
}

unsafe fn dict_u32(dict: &NSDictionary, key: *mut AnyObject) -> Option<u32> {
    dict.objectForKey(ns_key(key)).and_then(|obj| ns_u32(&obj))
}

fn is_cd_media_class(value: &str) -> bool {
    value == "CD" || value == "DRDeviceMediaClassCD" || value.ends_with("MediaClassCD")
}

fn is_audio_cd_media_type(value: &str) -> bool {
    value == "Audio CD"
        || value == "CD-DA"
        || value == "CD-ROM"
        || value == "DRDeviceMediaTypeCDROM"
        || value.contains("CDROM")
}

fn track_length_seconds(length_obj: &AnyObject) -> Option<f64> {
    if let Some(msf) = length_obj.downcast_ref::<DRMSF>() {
        return Some(msf.sectors() as f64 / 75.0);
    }
    length_obj
        .downcast_ref::<NSNumber>()
        .map(|blocks| blocks.as_u32() as f64 / 75.0)
}

fn device_bsd_name(device: &DRDevice) -> Option<String> {
    device.bsdName().map(|name| name.to_string())
}

/// 1-based `drutil -drive` index for the device matching `drive_id`.
pub fn drutil_drive_number(drive_id: &str) -> Option<String> {
    catch_dr("drutil_drive_number", || {
        autoreleasepool(|_| {
            let devices = DRDevice::devices();
            for (index, device) in devices.iter().enumerate() {
                if !device.isValid() {
                    continue;
                }
                if device_bsd_name(&device).as_deref() == Some(drive_id) {
                    return Some((index + 1).to_string());
                }
            }
            None
        })
    })
    .flatten()
}

pub fn list_devices() -> Vec<(String, String)> {
    catch_dr("list_devices", || {
        autoreleasepool(|_| {
            let devices = DRDevice::devices();
            devices
                .iter()
                .filter_map(|device| {
                    if !device.isValid() {
                        return None;
                    }
                    let id = device_bsd_name(&device)?;
                    let name = device.displayName().to_string();
                    Some((id, name))
                })
                .collect()
        })
    })
    .unwrap_or_default()
}

fn device_for_id(drive_id: &str) -> Option<Retained<DRDevice>> {
    catch_dr("device_for_id", || {
        autoreleasepool(|_| {
            let devices = DRDevice::devices();
            for device in devices.iter() {
                if !device.isValid() {
                    continue;
                }
                if device_bsd_name(&device).as_deref() == Some(drive_id) {
                    return Some(device);
                }
            }
            None
        })
    })
    .flatten()
}

/// Cheap check: drive still appears in DiscRecording's device list (no media I/O).
pub fn device_exists(drive_id: &str) -> bool {
    device_for_id(drive_id).is_some()
}

pub fn probe_presence(drive_id: &str) -> Option<bool> {
    catch_dr("probe_presence", || {
        let device = device_for_id(drive_id)?;
        autoreleasepool(|_| Some(drive_has_audio_cd(&device)))
    })
    .flatten()
}

pub fn eject(drive_id: &str) -> bool {
    catch_dr("eject", || {
        let Some(device) = device_for_id(drive_id) else {
            return false;
        };
        autoreleasepool(|_| device.ejectMedia())
    })
    .unwrap_or(false)
}

pub fn read_tracks(drive_id: &str) -> Option<Vec<(u32, f64)>> {
    catch_dr("read_tracks", || {
        let device = device_for_id(drive_id)?;
        autoreleasepool(|_| {
            if !drive_has_audio_cd(&device) {
                return None;
            }
            let tracks = tracks_from_status(&device);
            if tracks.is_empty() {
                None
            } else {
                Some(tracks)
            }
        })
    })
    .flatten()
}

fn drive_has_audio_cd(device: &DRDevice) -> bool {
    if !device.mediaIsPresent() {
        return false;
    }
    if device.mediaIsTransitioning() && !tracks_from_status(device).is_empty() {
        return true;
    }

    if let Some(media_type) = device.mediaType() {
        if is_audio_cd_media_type(&media_type.to_string()) {
            return true;
        }
    }

    let status = device.status();
    if let Some(media_info_obj) = status.objectForKey(unsafe { ns_key(DRDeviceMediaInfoKey) }) {
        if let Some(media_info) = media_info_obj.downcast_ref::<NSDictionary>() {
            unsafe {
                let media_class = dict_string(media_info, DRDeviceMediaClassKey);
                let media_type = dict_string(media_info, DRDeviceMediaTypeKey);
                let track_count = dict_u32(media_info, DRDeviceMediaTrackCountKey);
                let session_count = dict_u32(media_info, DRDeviceMediaSessionCountKey);

                if media_type.is_some_and(|t| is_audio_cd_media_type(&t)) {
                    return true;
                }
                if media_class.is_some_and(|c| is_cd_media_class(&c))
                    && track_count.is_some_and(|t| t > 0)
                    && session_count.is_some_and(|s| s > 0)
                {
                    return true;
                }
            }
        }
    }

    !tracks_from_status(device).is_empty()
}

fn tracks_from_status(device: &DRDevice) -> Vec<(u32, f64)> {
    let status = device.status();

    let (track_refs, track_info) = if let Some(refs_obj) =
        status.objectForKey(unsafe { ns_key(DRDeviceTrackRefsKey) })
    {
        let Some(info_obj) = status.objectForKey(unsafe { ns_key(DRDeviceTrackInfoKey) }) else {
            return Vec::new();
        };
        (refs_obj, info_obj)
    } else if let Some(media_info_obj) =
        status.objectForKey(unsafe { ns_key(DRDeviceMediaInfoKey) })
    {
        let Some(media_info) = media_info_obj.downcast_ref::<NSDictionary>() else {
            return Vec::new();
        };
        let Some(refs_obj) = media_info.objectForKey(unsafe { ns_key(DRDeviceTrackRefsKey) })
        else {
            return Vec::new();
        };
        let Some(info_obj) = media_info.objectForKey(unsafe { ns_key(DRDeviceTrackInfoKey) })
        else {
            return Vec::new();
        };
        (refs_obj, info_obj)
    } else {
        return Vec::new();
    };

    let Some(track_refs) = track_refs.downcast_ref::<NSArray>() else {
        return Vec::new();
    };
    let Some(track_info) = track_info.downcast_ref::<NSDictionary>() else {
        return Vec::new();
    };

    let mut candidate_tracks = Vec::new();
    for track_ref in track_refs.iter() {
        let Some(info_obj) = track_info.objectForKey(&track_ref) else {
            continue;
        };
        let Some(info) = info_obj.downcast_ref::<NSDictionary>() else {
            continue;
        };
        let properties = catch(AssertUnwindSafe(|| {
            track_ref
                .downcast_ref::<DRTrack>()
                .map(|track| track.properties())
        }))
        .ok()
        .flatten();
        let properties_ref = properties.as_deref();

        let mode = u32_from_track_dicts(info, properties_ref, unsafe { DRTrackModeKey });
        if mode.is_some_and(|m| m != 0) {
            continue;
        }

        let session = u32_from_track_dicts(info, properties_ref, unsafe { DRSessionNumberKey });
        let Some(number) = u32_from_track_dicts(info, properties_ref, unsafe { DRTrackNumberKey })
        else {
            continue;
        };

        let duration_seconds = info
            .objectForKey(unsafe { ns_key(DRTrackLengthKey) })
            .or_else(|| {
                properties_ref
                    .and_then(|props| props.objectForKey(unsafe { ns_key(DRTrackLengthKey) }))
            })
            .as_ref()
            .and_then(|obj| track_length_seconds(obj));

        if let Some(duration) = duration_seconds {
            candidate_tracks.push((number, duration, session));
        }
    }

    candidate_tracks.sort_by_key(|track| track.0);
    crate::cd::disc_id::keep_first_session(&candidate_tracks)
}

fn u32_from_track_dicts(
    info: &NSDictionary,
    properties: Option<&NSDictionary>,
    key: *mut AnyObject,
) -> Option<u32> {
    unsafe { dict_u32(info, key) }
        .or_else(|| properties.and_then(|props| unsafe { dict_u32(props, key) }))
}
