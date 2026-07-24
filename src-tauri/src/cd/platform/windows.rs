//! Windows CD-ROM platform: drive enum, TOC, presence, eject via Win32 IOCTLs.
#![cfg(target_os = "windows")]

use std::collections::HashMap;
use std::mem::{size_of, zeroed};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use windows::core::PCWSTR;
use windows::Win32::Devices::Cdrom::{
    CDROM_READ_TOC_EX, CDROM_READ_TOC_EX_FORMAT_CDTEXT, CDROM_TOC, IOCTL_CDROM_READ_TOC_EX,
    TRACK_DATA,
};
use windows::Win32::Foundation::{CloseHandle, GENERIC_READ, HANDLE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, GetDriveTypeW, GetLogicalDriveStringsW, GetVolumeInformationW, FILE_ATTRIBUTE_NORMAL,
    FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::IO::DeviceIoControl;
use windows::Win32::System::Ioctl::{IOCTL_STORAGE_CHECK_VERIFY, IOCTL_STORAGE_EJECT_MEDIA};
use windows::Win32::System::WindowsProgramming::DRIVE_CDROM;

use super::session::{
    begin_phase, cached_has_audio_cd_for_drive, drive_had_successful_read, invalidate_all_presence_cache,
    invalidate_presence_cache, is_any_drive_busy, is_read_in_progress, mark_drive_read_success,
    remove_drive, should_defer_user_disc_read, update_status_cache, DriveSessionPhase,
    PRESENCE_CACHE_TTL,
};
use crate::cd::types::{CdDisc, CdDiscCdText, CdDrive, CdTrackTitle};

use super::windows_cd_text::parse_cd_text_response;

const DISC_READ_ATTEMPTS: u32 = 4;
const DISC_READ_ATTEMPTS_KNOWN: u32 = 2;
const DISC_READ_RETRY: Duration = Duration::from_millis(750);

/// CD-DA frames per second.
const SECTORS_PER_SECOND: f64 = 75.0;

/// Output buffer for `IOCTL_CDROM_READ_TOC_EX` Format=CDTEXT (same ballpark as macOS).
const CDTEXT_READ_BUFFER_SIZE: usize = 0x2000;

/// Serialize in-process optical I/O — concurrent DeviceIoControl can confuse drives.
static DRIVE_IO_LOCK: Mutex<()> = Mutex::new(());

pub fn is_drive_busy() -> bool {
    is_any_drive_busy()
}

pub use super::session::{cached_disc_presence, set_detail_view_drive, should_skip_monitor_probe};

pub fn with_drive_lock<R>(f: impl FnOnce() -> R) -> Result<R, String> {
    let _guard = DRIVE_IO_LOCK
        .lock()
        .map_err(|_| "drive io lock poisoned".to_string())?;
    Ok(f())
}

fn try_with_drive_lock<R>(f: impl FnOnce() -> R) -> Option<R> {
    let _guard = DRIVE_IO_LOCK.try_lock().ok()?;
    Some(f())
}

/// Normalize drive id to `D:` form.
pub fn normalize_drive_id(drive_id: &str) -> Option<String> {
    let trimmed = drive_id.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Strip `\\.\` prefix if present.
    let rest = trimmed
        .strip_prefix(r"\\.\")
        .or_else(|| trimmed.strip_prefix(r"\\.\\"))
        .unwrap_or(trimmed);
    let letter = rest.chars().find(|c| c.is_ascii_alphabetic())?;
    let upper = letter.to_ascii_uppercase();
    Some(format!("{upper}:"))
}

fn drive_root_path(drive_id: &str) -> Option<String> {
    let id = normalize_drive_id(drive_id)?;
    Some(format!("{id}\\"))
}

fn device_path(drive_id: &str) -> Option<String> {
    let id = normalize_drive_id(drive_id)?;
    Some(format!(r"\\.\{id}"))
}

fn to_wide_null(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Open `\\.\D:` for IOCTL access.
pub fn open_drive_handle(drive_id: &str) -> Result<HANDLE, String> {
    let path = device_path(drive_id).ok_or_else(|| format!("Invalid drive id: {drive_id}"))?;
    let wide = to_wide_null(&path);
    unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            GENERIC_READ.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            None,
        )
        .map_err(|err| format!("Failed to open CD drive {drive_id}: {err}"))
    }
}

fn close_handle(handle: HANDLE) {
    unsafe {
        let _ = CloseHandle(handle);
    }
}

struct DriveHandle {
    handle: HANDLE,
}

impl DriveHandle {
    fn open(drive_id: &str) -> Result<Self, String> {
        Ok(Self {
            handle: open_drive_handle(drive_id)?,
        })
    }

    fn as_raw(&self) -> HANDLE {
        self.handle
    }
}

impl Drop for DriveHandle {
    fn drop(&mut self) {
        close_handle(self.handle);
    }
}

fn ioctl_empty(handle: HANDLE, control_code: u32) -> Result<(), String> {
    let mut returned = 0u32;
    unsafe {
        DeviceIoControl(
            handle,
            control_code,
            None,
            0,
            None,
            0,
            Some(&mut returned),
            None,
        )
        .map_err(|err| format!("DeviceIoControl 0x{control_code:x} failed: {err}"))?;
    }
    Ok(())
}

fn track_lba(track: &TRACK_DATA) -> u32 {
    // With READ_TOC_EX Msf=0, Address is a big-endian LBA in bytes 1..3.
    ((track.Address[1] as u32) << 16)
        | ((track.Address[2] as u32) << 8)
        | (track.Address[3] as u32)
}

/// Convert an MSF address to an absolute LBA (Red Book). Used by regression tests
/// documenting the old READ_TOC MSF-as-LBA bug.
#[cfg(test)]
fn msf_to_lba(minute: u8, second: u8, frame: u8) -> u32 {
    (u32::from(minute) * 60 + u32::from(second)) * 75 + u32::from(frame)
}

fn is_audio_track(track: &TRACK_DATA) -> bool {
    // TRACK_DATA packs Control (low 4) and Adr (high 4) into `_bitfield`.
    // Control bit 2 (0x04) set ⇒ data track.
    let control = track._bitfield & 0x0f;
    (control & 0x04) == 0
}

/// Absolute LBA range for a 1-based audio track: `[start, end)`.
#[derive(Debug, Clone, Copy)]
pub struct TrackBounds {
    pub start_lba: u32,
    pub end_lba: u32,
}

impl TrackBounds {
    pub fn sector_count(self) -> u32 {
        self.end_lba.saturating_sub(self.start_lba)
    }

    pub fn duration_seconds(self) -> f64 {
        self.sector_count() as f64 / SECTORS_PER_SECOND
    }
}

fn read_toc(handle: HANDLE) -> Result<CDROM_TOC, String> {
    // Deprecated IOCTL_CDROM_READ_TOC returns MSF addresses. Interpreting those
    // as LBA makes track 1 look almost right (~00:02:00 → 512) while later
    // tracks land far past the disc and RAW_READ fails with ERROR_INVALID_PARAMETER.
    let input = CDROM_READ_TOC_EX {
        // Format = TOC (low 4 bits), Msf = 0 (bit 7) → absolute LBA addresses.
        _bitfield: 0,
        SessionTrack: 0,
        Reserved2: 0,
        Reserved3: 0,
    };
    let mut toc: CDROM_TOC = unsafe { zeroed() };
    let mut returned = 0u32;
    unsafe {
        DeviceIoControl(
            handle,
            IOCTL_CDROM_READ_TOC_EX,
            Some((&input as *const CDROM_READ_TOC_EX).cast()),
            size_of::<CDROM_READ_TOC_EX>() as u32,
            Some((&mut toc as *mut CDROM_TOC).cast()),
            size_of::<CDROM_TOC>() as u32,
            Some(&mut returned),
            None,
        )
        .map_err(|err| format!("DeviceIoControl READ_TOC_EX failed: {err}"))?;
    }
    Ok(toc)
}

/// Parse TOC into ordered audio tracks as `(track_number, duration_seconds)`.
fn toc_audio_tracks(toc: &CDROM_TOC) -> Vec<(u32, f64)> {
    toc_track_bounds(toc)
        .into_iter()
        .map(|(number, bounds)| (number, bounds.duration_seconds()))
        .collect()
}

fn toc_track_bounds(toc: &CDROM_TOC) -> Vec<(u32, TrackBounds)> {
    let first = toc.FirstTrack;
    let last = toc.LastTrack;
    if first == 0 || last == 0 || last < first {
        return Vec::new();
    }

    // TrackData includes one entry per track plus lead-out (0xAA).
    let entry_count = (last - first + 1) as usize + 1;
    let entries: Vec<&TRACK_DATA> = toc.TrackData[..entry_count.min(100)].iter().collect();

    let mut bounds = Vec::new();
    for window in entries.windows(2) {
        let track = window[0];
        let next = window[1];
        if track.TrackNumber < first || track.TrackNumber > last {
            continue;
        }
        if !is_audio_track(track) {
            continue;
        }
        let start = track_lba(track);
        let end = track_lba(next);
        if end <= start {
            continue;
        }
        bounds.push((
            track.TrackNumber as u32,
            TrackBounds {
                start_lba: start,
                end_lba: end,
            },
        ));
    }
    bounds
}

/// Read absolute LBA bounds for a track (for CD-DA playback).
pub fn read_track_bounds(drive_id: &str, track_number: u32) -> Result<TrackBounds, String> {
    let handle = DriveHandle::open(drive_id)?;
    let toc = read_toc(handle.as_raw())?;
    toc_track_bounds(&toc)
        .into_iter()
        .find(|(number, _)| *number == track_number)
        .map(|(_, bounds)| bounds)
        .ok_or_else(|| format!("Track {track_number} not found on disc"))
}

fn probe_presence_unlocked(drive_id: &str) -> Result<bool, String> {
    let handle = match DriveHandle::open(drive_id) {
        Ok(h) => h,
        Err(_) => return Ok(false),
    };
    match ioctl_empty(handle.as_raw(), IOCTL_STORAGE_CHECK_VERIFY) {
        Ok(()) => {}
        Err(_) => return Ok(false),
    }
    // Prefer TOC: empty trays / data-only media without readable TOC ⇒ no audio disc.
    match read_toc(handle.as_raw()) {
        Ok(toc) => Ok(!toc_audio_tracks(&toc).is_empty()),
        Err(_) => Ok(false),
    }
}

fn read_disc_tracks_user(drive_id: &str) -> Result<Vec<(u32, f64)>, String> {
    let attempts = if drive_had_successful_read(drive_id) {
        DISC_READ_ATTEMPTS_KNOWN
    } else {
        DISC_READ_ATTEMPTS
    };
    let mut last_error = "Disc present but track info not ready yet".to_string();
    for attempt in 0..attempts {
        let result = with_drive_lock(|| {
            let handle = DriveHandle::open(drive_id)?;
            let toc = read_toc(handle.as_raw())?;
            Ok::<_, String>(toc_audio_tracks(&toc))
        });
        match result {
            Ok(Ok(tracks)) if !tracks.is_empty() => {
                update_status_cache(drive_id, Some(true), None);
                mark_drive_read_success(drive_id);
                return Ok(tracks);
            }
            Ok(Ok(_)) => {
                last_error = "Disc present but track info not ready yet".into();
            }
            Ok(Err(err)) | Err(err) => {
                let present = with_drive_lock(|| probe_presence_unlocked(drive_id))
                    .ok()
                    .and_then(|r| r.ok())
                    .unwrap_or(false);
                if !present {
                    update_status_cache(drive_id, Some(false), None);
                    return Err("No audio CD in drive".into());
                }
                last_error = err;
            }
        }
        if attempt + 1 < attempts {
            thread::sleep(DISC_READ_RETRY);
        }
    }
    Err(last_error)
}

fn list_cdrom_letters() -> Result<Vec<String>, String> {
    let mut buffer = vec![0u16; 256];
    loop {
        let needed = unsafe { GetLogicalDriveStringsW(Some(&mut buffer)) };
        if needed == 0 {
            return Err("GetLogicalDriveStringsW failed".into());
        }
        if (needed as usize) < buffer.len() {
            break;
        }
        buffer.resize(needed as usize + 1, 0);
    }

    let mut drives = Vec::new();
    let mut start = 0usize;
    while start < buffer.len() {
        if buffer[start] == 0 {
            break;
        }
        let end = buffer[start..]
            .iter()
            .position(|&c| c == 0)
            .map(|i| start + i)
            .unwrap_or(buffer.len());
        let root = String::from_utf16_lossy(&buffer[start..end]);
        start = end + 1;

        let wide = to_wide_null(&root);
        let drive_type = unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) };
        if drive_type == DRIVE_CDROM {
            if let Some(id) = normalize_drive_id(&root) {
                drives.push(id);
            }
        }
    }
    Ok(drives)
}

fn drive_display_name(drive_id: &str) -> String {
    let Some(root) = drive_root_path(drive_id) else {
        return format!("CD Drive ({drive_id})");
    };
    let wide_root = to_wide_null(&root);
    let mut volume_name = vec![0u16; 261];
    let ok = unsafe {
        GetVolumeInformationW(
            PCWSTR(wide_root.as_ptr()),
            Some(&mut volume_name),
            None,
            None,
            None,
            None,
        )
        .is_ok()
    };
    if ok {
        let end = volume_name.iter().position(|&c| c == 0).unwrap_or(0);
        if end > 0 {
            let name = String::from_utf16_lossy(&volume_name[..end]);
            if !name.is_empty() {
                return format!("{name} ({drive_id})");
            }
        }
    }
    format!("CD Drive ({drive_id})")
}

fn drives_from_letters(letters: &[String]) -> Vec<CdDrive> {
    letters
        .iter()
        .map(|id| CdDrive {
            id: id.clone(),
            name: drive_display_name(id),
            has_disc: false,
        })
        .collect()
}

pub fn list_drives() -> Result<Vec<CdDrive>, String> {
    let letters = with_drive_lock(list_cdrom_letters)??;
    Ok(drives_from_letters(&letters))
}

pub fn list_drives_try() -> Option<Result<Vec<CdDrive>, String>> {
    let letters = try_with_drive_lock(list_cdrom_letters)?;
    Some(letters.map(|l| drives_from_letters(&l)))
}

fn cached_probe_presence(drive_id: &str) -> Option<bool> {
    if is_read_in_progress(drive_id) {
        return Some(
            cached_has_audio_cd_for_drive(drive_id, PRESENCE_CACHE_TTL).unwrap_or(true),
        );
    }
    cached_has_audio_cd_for_drive(drive_id, PRESENCE_CACHE_TTL)
}

pub fn probe_disc_presence(drive_id: &str) -> Result<bool, String> {
    let drive_id = normalize_drive_id(drive_id)
        .ok_or_else(|| format!("Invalid drive id: {drive_id}"))?;
    if let Some(cached) = cached_probe_presence(&drive_id) {
        return Ok(cached);
    }

    with_drive_lock(|| {
        let has_disc = probe_presence_unlocked(&drive_id)?;
        update_status_cache(&drive_id, Some(has_disc), None);
        Ok(has_disc)
    })?
}

pub fn probe_disc_presence_try(drive_id: &str) -> Option<Result<bool, String>> {
    let drive_id = match normalize_drive_id(drive_id) {
        Some(id) => id,
        None => return Some(Err(format!("Invalid drive id: {drive_id}"))),
    };
    if should_skip_monitor_probe(&drive_id) {
        return Some(Ok(
            cached_has_audio_cd_for_drive(&drive_id, PRESENCE_CACHE_TTL).unwrap_or(true),
        ));
    }
    if let Some(cached) = cached_probe_presence(&drive_id) {
        return Some(Ok(cached));
    }

    let has_disc = match try_with_drive_lock(|| {
        probe_presence_unlocked(&drive_id).map(|present| {
            update_status_cache(&drive_id, Some(present), None);
            present
        })
    }) {
        Some(result) => result,
        None => return None,
    };
    Some(has_disc)
}

pub fn eject_disc(drive_id: &str) -> Result<(), String> {
    let drive_id = normalize_drive_id(drive_id)
        .ok_or_else(|| format!("Invalid drive id: {drive_id}"))?;

    crate::cd::playback::stop_for_drive(&drive_id);

    let _eject_guard = begin_phase(&drive_id, DriveSessionPhase::Ejecting);
    remove_drive(&drive_id);

    with_drive_lock(|| {
        let handle = DriveHandle::open(&drive_id)?;
        ioctl_empty(handle.as_raw(), IOCTL_STORAGE_EJECT_MEDIA)
            .map_err(|err| format!("Failed to eject drive {drive_id}: {err}"))
    })??;

    note_device_status_changed();
    Ok(())
}

pub fn get_disc_info(drive_id: &str) -> Result<Option<CdDisc>, String> {
    let drive_id = normalize_drive_id(drive_id)
        .ok_or_else(|| format!("Invalid drive id: {drive_id}"))?;

    if should_defer_user_disc_read(&drive_id) {
        return Err("Disc read deferred while drive is busy".into());
    }

    let _read_guard = begin_phase(&drive_id, DriveSessionPhase::ReadingMetadata);

    let toc_tracks = match read_disc_tracks_user(&drive_id) {
        Ok(tracks) => tracks,
        Err(err) if err == "No audio CD in drive" => return Ok(None),
        Err(err) => return Err(err),
    };

    Ok(Some(super::disc::build_disc_from_tracks(
        &drive_id,
        &toc_tracks,
        None,
        None,
        &HashMap::new(),
    )))
}

fn read_cd_text_raw(handle: HANDLE) -> Result<Vec<u8>, String> {
    let input = CDROM_READ_TOC_EX {
        // Format = CDTEXT (low 4 bits), Msf = 0.
        _bitfield: CDROM_READ_TOC_EX_FORMAT_CDTEXT as u8,
        SessionTrack: 0,
        Reserved2: 0,
        Reserved3: 0,
    };
    let mut buffer = vec![0u8; CDTEXT_READ_BUFFER_SIZE];
    let mut returned = 0u32;
    unsafe {
        DeviceIoControl(
            handle,
            IOCTL_CDROM_READ_TOC_EX,
            Some((&input as *const CDROM_READ_TOC_EX).cast()),
            size_of::<CDROM_READ_TOC_EX>() as u32,
            Some(buffer.as_mut_ptr().cast()),
            buffer.len() as u32,
            Some(&mut returned),
            None,
        )
        .map_err(|err| format!("DeviceIoControl READ_TOC_EX CDTEXT failed: {err}"))?;
    }
    buffer.truncate(returned as usize);
    Ok(buffer)
}

/// Background CD-Text read — merges into an existing disc on the frontend.
pub fn get_disc_cdtext(drive_id: &str) -> Result<Option<CdDiscCdText>, String> {
    let drive_id = normalize_drive_id(drive_id)
        .ok_or_else(|| format!("Invalid drive id: {drive_id}"))?;

    if should_defer_user_disc_read(&drive_id) {
        return Err("CD-Text read deferred while drive is busy".into());
    }

    let _read_guard = begin_phase(&drive_id, DriveSessionPhase::ReadingMetadata);

    let raw = match with_drive_lock(|| {
        let handle = DriveHandle::open(&drive_id)?;
        read_cd_text_raw(handle.as_raw())
    }) {
        Ok(Ok(buf)) => buf,
        Ok(Err(_)) | Err(_) => return Ok(None),
    };

    let parsed = parse_cd_text_response(&raw);
    if parsed.is_empty() {
        return Ok(None);
    }

    let mut track_titles: Vec<CdTrackTitle> = parsed
        .track_titles
        .into_iter()
        .map(|(number, title)| CdTrackTitle { number, title })
        .collect();
    track_titles.sort_by_key(|track| track.number);

    Ok(Some(CdDiscCdText {
        drive_id,
        album: parsed.album,
        artist: parsed.artist,
        track_titles,
    }))
}

pub fn is_optical_disc_volume(volume_path: &str) -> bool {
    let Some(id) = normalize_drive_id(volume_path) else {
        return false;
    };
    let Some(root) = drive_root_path(&id) else {
        return false;
    };
    let wide = to_wide_null(&root);
    unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) == DRIVE_CDROM }
}

pub fn note_volume_mounted(volume_path: &str) {
    if let Some(id) = normalize_drive_id(volume_path) {
        invalidate_presence_cache(&id);
    } else {
        invalidate_all_presence_cache();
    }
}

pub fn note_volume_unmounted(volume_path: &str) {
    if let Some(id) = normalize_drive_id(volume_path) {
        update_status_cache(&id, Some(false), None);
        invalidate_presence_cache(&id);
    } else {
        invalidate_all_presence_cache();
    }
}

pub fn note_device_status_changed() {
    invalidate_all_presence_cache();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_drive_id_accepts_common_forms() {
        assert_eq!(normalize_drive_id("d").as_deref(), Some("D:"));
        assert_eq!(normalize_drive_id("D:").as_deref(), Some("D:"));
        assert_eq!(normalize_drive_id("d:\\").as_deref(), Some("D:"));
        assert_eq!(normalize_drive_id(r"\\.\E:").as_deref(), Some("E:"));
        assert_eq!(normalize_drive_id("").as_deref(), None);
        assert_eq!(normalize_drive_id("1:").as_deref(), None);
    }

    #[test]
    fn msf_misread_as_lba_matches_reported_failure() {
        // Observed failure LBA 198423 == MSF 03:07:23 packed as big-endian.
        let false_lba = (3u32 << 16) | (7 << 8) | 23;
        assert_eq!(false_lba, 198_423);
        assert_eq!(msf_to_lba(3, 7, 23), 14_048);
        assert!(msf_to_lba(3, 7, 23) < 360_000); // within ~80 min disc
    }
}
