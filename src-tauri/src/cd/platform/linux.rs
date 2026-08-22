//! Linux CD-ROM platform: drive enum, TOC, presence, eject via `linux/cdrom.h` ioctls.
#![cfg(target_os = "linux")]

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use super::cd_text_packs::parse_cd_text_response;
use super::session::{
    begin_phase, cached_has_audio_cd_for_drive, drive_had_successful_read,
    invalidate_all_presence_cache, invalidate_presence_cache, is_any_drive_busy,
    is_read_in_progress, mark_drive_read_success, prune_missing_drives, remove_drive,
    should_defer_user_disc_read, update_status_cache, DriveSessionPhase, PRESENCE_CACHE_TTL,
};
use crate::cd::types::{CdDisc, CdDiscCdText, CdDrive, CdTrackTitle};

const DISC_READ_ATTEMPTS: u32 = 4;
const DISC_READ_ATTEMPTS_KNOWN: u32 = 2;
const DISC_READ_RETRY: Duration = Duration::from_millis(750);

/// CD-DA frames per second.
const SECTORS_PER_SECOND: f64 = 75.0;

/// Output buffer for MMC READ TOC Format=CDTEXT.
const CDTEXT_READ_BUFFER_SIZE: usize = 0x2000;

// linux/cdrom.h
const CDROMREADTOCHDR: libc::c_ulong = 0x5305;
const CDROMREADTOCENTRY: libc::c_ulong = 0x5306;
const CDROMEJECT: libc::c_ulong = 0x5309;
const CDROMREADAUDIO: libc::c_ulong = 0x530e;
const CDROM_DRIVE_STATUS: libc::c_ulong = 0x5326;
const CDROM_LOCKDOOR: libc::c_ulong = 0x5329;

const CDROM_LBA: u8 = 0x01;
const CDROM_LEADOUT: u8 = 0xAA;
const CDROM_DATA_TRACK: u8 = 0x04;
const CDS_DISC_OK: i32 = 4;

// scsi/sg.h
const SG_IO: libc::c_ulong = 0x2285;
const SG_DXFER_FROM_DEV: i32 = -3;
const SG_INFO_OK_MASK: u32 = 0x1;
const SG_INFO_OK: u32 = 0x0;

/// Serialize in-process optical I/O — concurrent ioctl can confuse drives.
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

/// Normalize drive id to `/dev/srN` form.
pub fn normalize_drive_id(drive_id: &str) -> Option<String> {
    let trimmed = drive_id.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Accept bare `sr0` or `/dev/sr0` (and realpath variants under /dev).
    let name = trimmed
        .strip_prefix("/dev/")
        .unwrap_or(trimmed)
        .trim_start_matches('/');
    if !name.starts_with("sr") {
        return None;
    }
    let suffix = &name[2..];
    if suffix.is_empty() || !suffix.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(format!("/dev/{name}"))
}

#[repr(C)]
struct CdromTochdr {
    cdth_trk0: u8,
    cdth_trk1: u8,
}

#[repr(C)]
struct CdromTocentry {
    cdte_track: u8,
    /// Low 4 = ADR, high 4 = CTRL (GCC bitfield packing on little-endian).
    cdte_adr_ctrl: u8,
    cdte_format: u8,
    _pad: u8,
    cdte_addr_lba: i32,
    cdte_datamode: u8,
    _pad2: [u8; 3],
}

#[repr(C)]
struct CdromReadAudio {
    addr_lba: i32,
    addr_format: u8,
    _pad0: [u8; 3],
    nframes: i32,
    _pad1: [u8; 4],
    buf: *mut u8,
}

#[repr(C)]
struct SgIoHdr {
    interface_id: i32,
    dxfer_direction: i32,
    cmd_len: u8,
    mx_sb_len: u8,
    iovec_count: u16,
    dxfer_len: u32,
    dxferp: *mut libc::c_void,
    cmdp: *mut u8,
    sbp: *mut u8,
    timeout: u32,
    flags: u32,
    pack_id: i32,
    usr_ptr: *mut libc::c_void,
    status: u8,
    masked_status: u8,
    msg_status: u8,
    sb_len_wr: u8,
    host_status: u16,
    driver_status: u16,
    resid: i32,
    duration: u32,
    info: u32,
}

struct DriveHandle {
    file: File,
}

/// Open `/dev/srN` for ioctl / CD-DA reads (shared with playback).
pub fn open_drive_handle(drive_id: &str) -> Result<File, String> {
    let path =
        normalize_drive_id(drive_id).ok_or_else(|| format!("Invalid drive id: {drive_id}"))?;
    OpenOptions::new()
        .read(true)
        .write(false)
        .custom_flags(libc::O_NONBLOCK)
        .open(&path)
        .map_err(|err| format!("Failed to open CD drive {path}: {err}"))
}

impl DriveHandle {
    fn open(drive_id: &str) -> Result<Self, String> {
        Ok(Self {
            file: open_drive_handle(drive_id)?,
        })
    }

    fn as_raw(&self) -> RawFd {
        self.file.as_raw_fd()
    }
}

fn ioctl_result(fd: RawFd, request: libc::c_ulong, arg: libc::c_ulong) -> Result<i32, String> {
    let rc = unsafe { libc::ioctl(fd, request, arg) };
    if rc < 0 {
        let err = io::Error::last_os_error();
        return Err(format!("ioctl 0x{request:x} failed: {err}"));
    }
    Ok(rc)
}

fn ioctl_ptr<T>(fd: RawFd, request: libc::c_ulong, arg: *mut T) -> Result<i32, String> {
    ioctl_result(fd, request, arg as libc::c_ulong)
}

fn ioctl_int(fd: RawFd, request: libc::c_ulong, arg: libc::c_int) -> Result<i32, String> {
    ioctl_result(fd, request, arg as libc::c_ulong)
}

fn tocentry_ctrl(entry: &CdromTocentry) -> u8 {
    (entry.cdte_adr_ctrl >> 4) & 0x0f
}

fn is_audio_track(entry: &CdromTocentry) -> bool {
    (tocentry_ctrl(entry) & CDROM_DATA_TRACK) == 0
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

fn read_toc_entry(fd: RawFd, track: u8) -> Result<CdromTocentry, String> {
    let mut entry = CdromTocentry {
        cdte_track: track,
        cdte_adr_ctrl: 0,
        cdte_format: CDROM_LBA,
        _pad: 0,
        cdte_addr_lba: 0,
        cdte_datamode: 0,
        _pad2: [0; 3],
    };
    ioctl_ptr(fd, CDROMREADTOCENTRY, &mut entry)?;
    Ok(entry)
}

fn read_toc_bounds(fd: RawFd) -> Result<Vec<(u32, TrackBounds)>, String> {
    let mut hdr = CdromTochdr {
        cdth_trk0: 0,
        cdth_trk1: 0,
    };
    ioctl_ptr(fd, CDROMREADTOCHDR, &mut hdr)?;
    let first = hdr.cdth_trk0;
    let last = hdr.cdth_trk1;
    if first == 0 || last == 0 || last < first {
        return Ok(Vec::new());
    }

    let mut entries: Vec<(u8, CdromTocentry)> = Vec::new();
    for track in first..=last {
        entries.push((track, read_toc_entry(fd, track)?));
    }
    let leadout = read_toc_entry(fd, CDROM_LEADOUT)?;
    entries.push((CDROM_LEADOUT, leadout));

    let mut bounds = Vec::new();
    for window in entries.windows(2) {
        let (track_num, track) = &window[0];
        let (_, next) = &window[1];
        if *track_num == CDROM_LEADOUT {
            continue;
        }
        if !is_audio_track(track) {
            continue;
        }
        let start = track.cdte_addr_lba.max(0) as u32;
        let end = next.cdte_addr_lba.max(0) as u32;
        if end <= start {
            continue;
        }
        bounds.push((
            u32::from(*track_num),
            TrackBounds {
                start_lba: start,
                end_lba: end,
            },
        ));
    }
    Ok(bounds)
}

fn toc_audio_tracks(fd: RawFd) -> Result<Vec<(u32, f64)>, String> {
    Ok(read_toc_bounds(fd)?
        .into_iter()
        .map(|(number, bounds)| (number, bounds.duration_seconds()))
        .collect())
}

/// Read absolute LBA bounds for a track (for CD-DA playback).
pub fn read_track_bounds(drive_id: &str, track_number: u32) -> Result<TrackBounds, String> {
    let handle = DriveHandle::open(drive_id)?;
    read_toc_bounds(handle.as_raw())?
        .into_iter()
        .find(|(number, _)| *number == track_number)
        .map(|(_, bounds)| bounds)
        .ok_or_else(|| format!("Track {track_number} not found on disc"))
}

/// Read `count` raw CD-DA sectors starting at absolute LBA into `buf` (2352 * count bytes).
pub fn read_cdda_sectors(
    fd: RawFd,
    start_lba: u32,
    count: u32,
    buf: &mut [u8],
) -> Result<usize, String> {
    let need = (count as usize).saturating_mul(2352);
    if buf.len() < need {
        return Err("CD-DA read buffer too small".into());
    }
    if count == 0 {
        return Ok(0);
    }
    let mut req = CdromReadAudio {
        addr_lba: start_lba as i32,
        addr_format: CDROM_LBA,
        _pad0: [0; 3],
        nframes: count as i32,
        _pad1: [0; 4],
        buf: buf.as_mut_ptr(),
    };
    ioctl_ptr(fd, CDROMREADAUDIO, &mut req)
        .map_err(|err| format!("CD-DA read failed at LBA {start_lba}: {err}"))?;
    Ok(need)
}

fn probe_presence_unlocked(drive_id: &str) -> Result<bool, String> {
    let handle = match DriveHandle::open(drive_id) {
        Ok(h) => h,
        Err(_) => return Ok(false),
    };
    let status = match ioctl_int(handle.as_raw(), CDROM_DRIVE_STATUS, 0) {
        Ok(s) => s,
        Err(_) => return Ok(false),
    };
    if status != CDS_DISC_OK {
        return Ok(false);
    }
    match toc_audio_tracks(handle.as_raw()) {
        Ok(tracks) => Ok(!tracks.is_empty()),
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
            toc_audio_tracks(handle.as_raw())
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

fn list_sr_devices() -> Result<Vec<String>, String> {
    let sys_block = Path::new("/sys/class/block");
    let entries = match fs::read_dir(sys_block) {
        Ok(e) => e,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(format!("Failed to list optical drives: {err}")),
    };

    let mut drives = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("sr") {
            continue;
        }
        let suffix = &name[2..];
        if suffix.is_empty() || !suffix.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let path = format!("/dev/{name}");
        if Path::new(&path).exists() {
            drives.push(path);
        }
    }
    drives.sort();
    Ok(drives)
}

fn drive_display_name(drive_id: &str) -> String {
    let Some(id) = normalize_drive_id(drive_id) else {
        return format!("CD Drive ({drive_id})");
    };
    let dev_name = id.trim_start_matches("/dev/");
    let model_path = PathBuf::from(format!("/sys/class/block/{dev_name}/device/model"));
    if let Ok(raw) = fs::read_to_string(&model_path) {
        let name = raw.trim();
        if !name.is_empty() {
            return format!("{name} ({id})");
        }
    }
    format!("CD Drive ({id})")
}

fn drives_from_paths(paths: &[String]) -> Vec<CdDrive> {
    paths
        .iter()
        .map(|id| CdDrive {
            id: id.clone(),
            name: drive_display_name(id),
            has_disc: false,
        })
        .collect()
}

pub fn list_drives() -> Result<Vec<CdDrive>, String> {
    let paths = with_drive_lock(list_sr_devices)??;
    Ok(drives_from_paths(&paths))
}

pub fn list_drives_try() -> Option<Result<Vec<CdDrive>, String>> {
    let paths = try_with_drive_lock(list_sr_devices)?;
    Some(paths.map(|p| drives_from_paths(&p)))
}

fn cached_probe_presence(drive_id: &str) -> Option<bool> {
    if is_read_in_progress(drive_id) {
        return Some(cached_has_audio_cd_for_drive(drive_id, PRESENCE_CACHE_TTL).unwrap_or(true));
    }
    cached_has_audio_cd_for_drive(drive_id, PRESENCE_CACHE_TTL)
}

pub fn probe_disc_presence(drive_id: &str) -> Result<bool, String> {
    let drive_id =
        normalize_drive_id(drive_id).ok_or_else(|| format!("Invalid drive id: {drive_id}"))?;
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
        return Some(Ok(cached_has_audio_cd_for_drive(
            &drive_id,
            PRESENCE_CACHE_TTL,
        )
        .unwrap_or(true)));
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
    let drive_id =
        normalize_drive_id(drive_id).ok_or_else(|| format!("Invalid drive id: {drive_id}"))?;

    crate::cd::playback::stop_for_drive(&drive_id);

    let _eject_guard = begin_phase(&drive_id, DriveSessionPhase::Ejecting);
    remove_drive(&drive_id);

    with_drive_lock(|| {
        let handle = DriveHandle::open(&drive_id)?;
        let fd = handle.as_raw();
        // Best-effort unlock before eject.
        let _ = ioctl_int(fd, CDROM_LOCKDOOR, 0);
        ioctl_int(fd, CDROMEJECT, 0)
            .map(|_| ())
            .map_err(|err| format!("Failed to eject drive {drive_id}: {err}"))
    })??;

    note_device_status_changed();
    Ok(())
}

pub fn get_disc_info(drive_id: &str) -> Result<Option<CdDisc>, String> {
    let drive_id =
        normalize_drive_id(drive_id).ok_or_else(|| format!("Invalid drive id: {drive_id}"))?;

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

fn read_cd_text_raw(fd: RawFd) -> Result<Vec<u8>, String> {
    // MMC READ TOC/PMA/ATIP (0x43), Format = 5 (CD-TEXT).
    let mut cdb = [0u8; 10];
    cdb[0] = 0x43;
    cdb[2] = 0x05;
    let alloc = CDTEXT_READ_BUFFER_SIZE as u16;
    cdb[7] = (alloc >> 8) as u8;
    cdb[8] = (alloc & 0xff) as u8;

    let mut buffer = vec![0u8; CDTEXT_READ_BUFFER_SIZE];
    let mut sense = [0u8; 32];
    let mut hdr = SgIoHdr {
        interface_id: i32::from(b'S'),
        dxfer_direction: SG_DXFER_FROM_DEV,
        cmd_len: cdb.len() as u8,
        mx_sb_len: sense.len() as u8,
        iovec_count: 0,
        dxfer_len: buffer.len() as u32,
        dxferp: buffer.as_mut_ptr().cast(),
        cmdp: cdb.as_mut_ptr(),
        sbp: sense.as_mut_ptr(),
        timeout: 30_000,
        flags: 0,
        pack_id: 0,
        usr_ptr: std::ptr::null_mut(),
        status: 0,
        masked_status: 0,
        msg_status: 0,
        sb_len_wr: 0,
        host_status: 0,
        driver_status: 0,
        resid: 0,
        duration: 0,
        info: 0,
    };

    ioctl_ptr(fd, SG_IO, &mut hdr).map_err(|err| format!("SG_IO CD-Text failed: {err}"))?;
    if (hdr.info & SG_INFO_OK_MASK) != SG_INFO_OK || hdr.status != 0 {
        return Err("CD-Text not available".into());
    }
    let transferred = buffer.len().saturating_sub(hdr.resid.max(0) as usize);
    buffer.truncate(transferred);
    Ok(buffer)
}

/// Background CD-Text read — merges into an existing disc on the frontend.
pub fn get_disc_cdtext(drive_id: &str) -> Result<Option<CdDiscCdText>, String> {
    let drive_id =
        normalize_drive_id(drive_id).ok_or_else(|| format!("Invalid drive id: {drive_id}"))?;

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
    normalize_drive_id(volume_path).is_some()
}

pub fn note_volume_mounted(volume_path: &str) {
    if let Some(id) = normalize_drive_id(volume_path) {
        invalidate_presence_cache(&id);
    } else {
        invalidate_all_presence_cache();
    }
}

pub fn note_volume_unmounted(volume_path: &str) -> bool {
    if let Some(id) = normalize_drive_id(volume_path) {
        update_status_cache(&id, Some(false), None);
        invalidate_presence_cache(&id);
        true
    } else {
        invalidate_all_presence_cache();
        true
    }
}

pub fn note_device_status_changed() {
    invalidate_all_presence_cache();
}

/// Remove sessions for drives that disappeared from enumeration (e.g. USB unplug).
pub fn prune_missing_drive_sessions(drives: &[CdDrive]) -> bool {
    let ids: Vec<String> = drives.iter().map(|d| d.id.clone()).collect();
    prune_missing_drives(&ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_drive_id_accepts_common_forms() {
        assert_eq!(normalize_drive_id("/dev/sr0").as_deref(), Some("/dev/sr0"));
        assert_eq!(normalize_drive_id("sr0").as_deref(), Some("/dev/sr0"));
        assert_eq!(
            normalize_drive_id("  /dev/sr12 ").as_deref(),
            Some("/dev/sr12")
        );
        assert_eq!(normalize_drive_id("").as_deref(), None);
        assert_eq!(normalize_drive_id("/dev/sda").as_deref(), None);
        assert_eq!(normalize_drive_id("sr").as_deref(), None);
        assert_eq!(normalize_drive_id("/dev/sr0a").as_deref(), None);
    }

    #[test]
    fn track_bounds_duration_uses_75_sectors_per_second() {
        let bounds = TrackBounds {
            start_lba: 0,
            end_lba: 7500,
        };
        assert_eq!(bounds.sector_count(), 7500);
        assert!((bounds.duration_seconds() - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn struct_sizes_match_kernel() {
        assert_eq!(std::mem::size_of::<CdromTochdr>(), 2);
        assert_eq!(std::mem::size_of::<CdromTocentry>(), 12);
        assert_eq!(std::mem::size_of::<CdromReadAudio>(), 24);
        assert_eq!(std::mem::size_of::<SgIoHdr>(), 88);
    }
}
