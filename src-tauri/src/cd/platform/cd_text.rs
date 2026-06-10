//! In-process CD-Text via DiscRecording SPI (`__DRDeviceReadCDText`) and
//! public `DRCDTextBlock` parsing. Same path `drutil cdtext` uses internally.
#![cfg(target_os = "macos")]
#![allow(non_snake_case)]

use objc2::exception::catch;
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::AnyObject;
use objc2::{extern_class, extern_methods};
use objc2_foundation::{NSArray, NSDictionary, NSData, NSObject, NSString};
use std::collections::HashMap;
use std::ffi::c_void;
use std::panic::AssertUnwindSafe;

const CDTEXT_READ_BUFFER_SIZE: u32 = 0x2000;

type DRDeviceRef = *mut c_void;

#[repr(C)]
struct DRSenseBuffer {
    bytes: [u8; 32],
}

pub struct CdTextData {
    pub album: Option<String>,
    pub artist: Option<String>,
    pub track_titles: HashMap<u32, String>,
}

extern_class!(
    #[unsafe(super(NSObject))]
    #[name = "DRCDTextBlock"]
    pub struct DRCDTextBlock;
);

impl DRCDTextBlock {
    extern_methods!(
        #[unsafe(method(arrayOfCDTextBlocksFromPacks:))]
        #[unsafe(method_family = none)]
        fn arrayOfCDTextBlocksFromPacks(packs: &NSData) -> Option<Retained<NSArray>>;

        #[unsafe(method(trackDictionaries))]
        fn trackDictionaries(&self) -> Retained<NSArray>;
    );
}

#[link(name = "DiscRecording", kind = "framework")]
extern "C" {
    static DRCDTextTitleKey: *mut AnyObject;
    static DRCDTextPerformerKey: *mut AnyObject;
    fn DRDeviceCopyDeviceForBSDName(name: *const c_void) -> DRDeviceRef;
    fn DRDeviceIsValid(device: DRDeviceRef) -> bool;
    // Framework exports `__DRDeviceReadCDText`; macOS prepends `_` to `link_name`.
    #[link_name = "_DRDeviceReadCDText"]
    fn DRDeviceReadCDText(
        device: DRDeviceRef,
        buffer: *mut u8,
        buffer_size: *mut u32,
        sense: *mut DRSenseBuffer,
    ) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
}

fn ns_key(ptr: *mut AnyObject) -> &'static NSString {
    unsafe { &*ptr.cast() }
}

fn dict_string(dict: &NSDictionary, key: *mut AnyObject) -> Option<String> {
    dict.objectForKey(ns_key(key))
        .and_then(|obj| obj.downcast_ref::<NSString>().map(|s| s.to_string()))
}

fn catch_cdtext<T>(label: &str, f: impl FnOnce() -> T) -> Option<T> {
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

fn device_ref_for_bsd_name(bsd_name: &str) -> Option<DRDeviceRef> {
    let name = NSString::from_str(bsd_name);
    let name_ptr = std::ptr::from_ref::<NSString>(name.as_ref()).cast::<c_void>();
    let device = unsafe { DRDeviceCopyDeviceForBSDName(name_ptr) };
    if device.is_null() {
        return None;
    }
    Some(device)
}

fn release_device_ref(device: DRDeviceRef) {
    if !device.is_null() {
        unsafe { CFRelease(device as *const c_void) };
    }
}

fn cdtext_from_block(block: &DRCDTextBlock) -> Option<CdTextData> {
    let track_dicts = block.trackDictionaries();
    if track_dicts.count() == 0 {
        return None;
    }

    let mut album = None;
    let mut artist = None;
    let mut track_titles = HashMap::new();

    let disc_dict = track_dicts.objectAtIndex(0);
    if let Some(disc_dict) = disc_dict.downcast_ref::<NSDictionary>() {
        album = dict_string(disc_dict, unsafe { DRCDTextTitleKey });
        artist = dict_string(disc_dict, unsafe { DRCDTextPerformerKey });
    }

    for index in 1..track_dicts.count() {
        let track_dict = track_dicts.objectAtIndex(index);
        let Some(track_dict) = track_dict.downcast_ref::<NSDictionary>() else {
            continue;
        };
        if let Some(title) = dict_string(track_dict, unsafe { DRCDTextTitleKey }) {
            track_titles.insert(index as u32, title);
        }
    }

    if album.is_none() && artist.is_none() && track_titles.is_empty() {
        None
    } else {
        Some(CdTextData {
            album,
            artist,
            track_titles,
        })
    }
}

fn read_cdtext_inner(drive_id: &str) -> Option<CdTextData> {
    autoreleasepool(|_| {
        let device = device_ref_for_bsd_name(drive_id)?;
        if !unsafe { DRDeviceIsValid(device) } {
            release_device_ref(device);
            return None;
        }

        let mut buffer = vec![0u8; CDTEXT_READ_BUFFER_SIZE as usize];
        let mut size = CDTEXT_READ_BUFFER_SIZE;
        let mut sense = DRSenseBuffer { bytes: [0; 32] };

        let status = unsafe {
            DRDeviceReadCDText(
                device,
                buffer.as_mut_ptr(),
                &mut size,
                &mut sense,
            )
        };
        release_device_ref(device);

        if status != 0 {
            eprintln!("DiscRecording read_cdtext: status {status:#x}");
            return None;
        }
        if size == 0 {
            return None;
        }

        let packs = NSData::with_bytes(&buffer[..size as usize]);
        let blocks = DRCDTextBlock::arrayOfCDTextBlocksFromPacks(&packs)?;
        if blocks.count() == 0 {
            return None;
        }

        let block_obj = blocks.objectAtIndex(0);
        let block = block_obj.downcast_ref::<DRCDTextBlock>()?;
        cdtext_from_block(block)
    })
}

/// Read CD-Text in-process via DiscRecording (no subprocess).
pub fn read_cdtext(drive_id: &str) -> Option<CdTextData> {
    catch_cdtext("read_cdtext", || read_cdtext_inner(drive_id)).flatten()
}
