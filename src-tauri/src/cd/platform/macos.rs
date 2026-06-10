use super::disc_recording;
use super::session::{
    begin_phase, cached_has_audio_cd_for_drive, cached_volume_path, drive_had_successful_read,
    invalidate_all_presence_cache, invalidate_presence_cache, is_any_drive_busy, is_playing,
    is_read_in_progress, mark_drive_read_success, remove_drive, update_status_cache,
    DriveSessionPhase, PRESENCE_CACHE_TTL,
};

use crate::cd::types::{CdDisc, CdDiscCdText, CdDrive, CdTrack, CdTrackTitle};
use std::collections::HashMap;
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

const DISC_READ_ATTEMPTS: u32 = 4;
const DISC_READ_ATTEMPTS_KNOWN: u32 = 2;
const DISC_READ_RETRY: Duration = Duration::from_millis(750);

/// Serialize in-process DiscRecording access — concurrent drive I/O causes remount loops.
static DRIVE_IO_LOCK: Mutex<()> = Mutex::new(());

/// True while a disc read or eject is in progress — background monitor should wait.
pub fn is_drive_busy() -> bool {
    is_any_drive_busy()
}

pub use super::session::{cached_disc_presence, set_detail_view_drive, should_skip_monitor_probe};

fn normalize_volume_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed.trim_end_matches('/').to_string()
}

/// True when `diskutil info` output describes removable optical / audio CD media.
pub fn diskutil_info_indicates_optical_disc(info: &str) -> bool {
    if info.contains("Audio CD") || info.contains("CD-DA") {
        return true;
    }
    if !info.contains("CD-ROM") {
        return false;
    }
    info.contains("Removable Media:") && info.contains("Yes")
}

/// Whether a mounted volume path is an optical audio/data CD (via diskutil, no drutil).
pub fn is_optical_disc_volume(volume_path: &str) -> bool {
    let path = normalize_volume_path(volume_path);
    if path.is_empty() {
        return false;
    }
    run_diskutil(&["info", &path])
        .map(|info| diskutil_info_indicates_optical_disc(&info))
        .unwrap_or(false)
}

fn bsd_name_from_device_identifier(identifier: &str) -> Option<String> {
    let trimmed = identifier.trim();
    if trimmed.is_empty() {
        return None;
    }
    // `disk4s0` → `disk4`; bare `disk4` is unchanged.
    if let Some(pos) = trimmed.rfind('s') {
        let suffix = &trimmed[pos + 1..];
        if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
            return Some(trimmed[..pos].to_string());
        }
    }
    Some(trimmed.to_string())
}

fn bsd_name_from_volume_path(volume_path: &str) -> Option<String> {
    let path = normalize_volume_path(volume_path);
    if path.is_empty() {
        return None;
    }
    let info = run_diskutil(&["info", &path]).ok()?;
    for line in info.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Device Identifier:") {
            return bsd_name_from_device_identifier(rest);
        }
    }
    None
}

/// NSWorkspace mount hint — expire cached presence for the affected drive only.
pub fn note_volume_mounted(volume_path: &str) {
    let Some(bsd_name) = bsd_name_from_volume_path(volume_path) else {
        invalidate_all_presence_cache();
        return;
    };
    invalidate_presence_cache(&bsd_name);
}

/// DiscRecording media change — no volume path, so invalidate all cached presence.
pub fn note_device_status_changed() {
    invalidate_all_presence_cache();
}

/// NSWorkspace unmount hint — clear disc presence for the matching drive.
pub fn note_volume_unmounted(volume_path: &str) {
    let normalized = normalize_volume_path(volume_path);
    let bsd_name = bsd_name_from_volume_path(&normalized);
    super::session::clear_drive_on_unmount(&normalized, bsd_name.as_deref());
}

fn run_command(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|err| format!("Failed to run {program}: {err}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        if message.is_empty() {
            return Err(format!(
                "{program} {} exited with status {}",
                args.join(" "),
                output.status
            ));
        }
        return Err(message);
    }

    Ok(stdout)
}

fn with_drive_lock<R>(f: impl FnOnce() -> R) -> Result<R, String> {
    let _guard = DRIVE_IO_LOCK
        .lock()
        .map_err(|_| "drive io lock poisoned".to_string())?;
    Ok(f())
}

fn try_with_drive_lock<R>(f: impl FnOnce() -> R) -> Option<R> {
    let _guard = DRIVE_IO_LOCK.try_lock().ok()?;
    Some(f())
}

fn run_diskutil(args: &[&str]) -> Result<String, String> {
    run_command("/usr/sbin/diskutil", args)
}

fn volume_path_from_bsd_name(bsd_name: &str) -> Option<String> {
    let dev = format!("/dev/{bsd_name}");
    let info = run_diskutil(&["info", &dev]).ok()?;
    for line in info.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Mount Point:") {
            let path = rest.trim();
            if !path.is_empty() && path != "Not applicable (no file system)" {
                return Some(path.to_string());
            }
        }
    }
    None
}

pub(crate) fn mounted_volume_path(drive_id: &str) -> Option<String> {
    if let Some(path) = cached_volume_path(drive_id) {
        return Some(path);
    }
    let path = volume_path_from_bsd_name(drive_id)?;
    update_status_cache(drive_id, None, Some(path.clone()));
    Some(path)
}

fn plist_string_value(chunk: &str, key: &str) -> Option<String> {
    let marker = format!("<key>{key}</key>");
    let rest = chunk.split(&marker).nth(1)?.trim_start();
    let inner = rest.strip_prefix("<string>")?;
    let end = inner.find("</string>")?;
    Some(decode_xml_entities(&inner[..end]))
}

fn decode_xml_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn parse_cdtext(cdtext: &str) -> (Option<String>, Option<String>, HashMap<u32, String>) {
    let mut album = None;
    let mut artist = None;
    let mut track_titles = HashMap::new();

    if !cdtext.contains("<key>Tracks</key>") {
        return (album, artist, track_titles);
    }

    let tracks_section = cdtext.split("<key>Tracks</key>").nth(1).unwrap_or("");
    for (index, dict) in tracks_section.split("<dict>").enumerate().skip(1) {
        let title = plist_string_value(dict, "DRCDTextTitleKey");
        let performer = plist_string_value(dict, "DRCDTextPerformerKey");
        if index == 1 {
            album = title;
            artist = performer;
            continue;
        }
        if index >= 2 {
            if let Some(title) = title {
                track_titles.insert((index - 1) as u32, title);
            }
        }
    }

    (album, artist, track_titles)
}

fn build_disc_from_tracks(
    drive_id: &str,
    toc_tracks: &[(u32, f64)],
    album: Option<String>,
    artist: Option<String>,
    cdtext_titles: &HashMap<u32, String>,
) -> CdDisc {
    let mut tracks = Vec::new();
    for (number, duration_seconds) in toc_tracks {
        let title = cdtext_titles
            .get(number)
            .cloned()
            .unwrap_or_else(|| format!("Track {number}"));
        tracks.push(CdTrack {
            number: *number,
            title,
            artist: artist.clone(),
            duration_seconds: Some(*duration_seconds),
        });
    }
    tracks.sort_by_key(|track| track.number);
    CdDisc {
        drive_id: drive_id.to_string(),
        disc_id: None,
        album,
        artist,
        tracks,
    }
}

fn drives_from_list(devices: &[(String, String)]) -> Vec<CdDrive> {
    devices
        .iter()
        .map(|(id, name)| CdDrive {
            id: id.clone(),
            name: name.clone(),
            has_disc: false,
        })
        .collect()
}

/// Enumerate optical drives without touching the disc (fast — no drive spin-up).
pub fn list_drives() -> Result<Vec<CdDrive>, String> {
    let devices = with_drive_lock(|| disc_recording::list_devices())?;
    Ok(drives_from_list(&devices))
}

/// Fast drive list for the background monitor — yields if the drive lock is busy.
pub fn list_drives_try() -> Option<Result<Vec<CdDrive>, String>> {
    let devices = try_with_drive_lock(|| disc_recording::list_devices())?;
    Some(Ok(drives_from_list(&devices)))
}

fn cached_probe_presence(drive_id: &str) -> Option<bool> {
    if is_read_in_progress(drive_id) {
        return Some(
            cached_has_audio_cd_for_drive(drive_id, PRESENCE_CACHE_TTL).unwrap_or(true),
        );
    }
    cached_has_audio_cd_for_drive(drive_id, PRESENCE_CACHE_TTL)
}

/// Single status probe via DiscRecording (no subprocess).
pub fn probe_disc_presence(drive_id: &str) -> Result<bool, String> {
    if let Some(cached) = cached_probe_presence(drive_id) {
        return Ok(cached);
    }

    with_drive_lock(|| {
        let has_disc = disc_recording::probe_presence(drive_id)
            .ok_or_else(|| format!("Drive {drive_id} not found"))?;
        update_status_cache(drive_id, Some(has_disc), None);
        Ok(has_disc)
    })?
}

/// Background presence probe — yields if the drive lock is busy.
pub fn probe_disc_presence_try(drive_id: &str) -> Option<Result<bool, String>> {
    if should_skip_monitor_probe(drive_id) {
        return Some(Ok(
            cached_has_audio_cd_for_drive(drive_id, PRESENCE_CACHE_TTL).unwrap_or(true),
        ));
    }
    if let Some(cached) = cached_probe_presence(drive_id) {
        return Some(Ok(cached));
    }

    let has_disc = match try_with_drive_lock(|| {
        disc_recording::probe_presence(drive_id).map(|present| {
            update_status_cache(drive_id, Some(present), None);
            present
        })
    }) {
        Some(result) => result?,
        None => return None,
    };
    Some(Ok(has_disc))
}

fn read_disc_tracks_user(drive_id: &str) -> Result<Vec<(u32, f64)>, String> {
    let attempts = if drive_had_successful_read(drive_id) {
        DISC_READ_ATTEMPTS_KNOWN
    } else {
        DISC_READ_ATTEMPTS
    };
    let mut last_error = "Disc present but track info not ready yet".to_string();
    for attempt in 0..attempts {
        let tracks = with_drive_lock(|| disc_recording::read_tracks(drive_id)).ok().flatten();
        match tracks {
            Some(tracks) if !tracks.is_empty() => {
                update_status_cache(drive_id, Some(true), None);
                mark_drive_read_success(drive_id);
                return Ok(tracks);
            }
            Some(_) => {
                last_error = "Disc present but track info not ready yet".into();
            }
            None => {
                let present = with_drive_lock(|| disc_recording::probe_presence(drive_id))
                    .ok()
                    .flatten()
                    .unwrap_or(false);
                if !present {
                    update_status_cache(drive_id, Some(false), None);
                    return Err("No audio CD in drive".into());
                }
                last_error = "Disc present but track info not ready yet".into();
            }
        }
        if attempt + 1 < attempts {
            thread::sleep(DISC_READ_RETRY);
        }
    }
    Err(last_error)
}

pub fn eject_disc(drive_id: &str) -> Result<(), String> {
    // Playback holds the cddafs volume open — release it before unmounting.
    crate::cd::playback::stop_for_drive(drive_id);

    let _eject_guard = begin_phase(drive_id, DriveSessionPhase::Ejecting);
    remove_drive(drive_id);

    // Prefer diskutil on the mounted volume (Finder / Music path), then DRDevice.ejectMedia.
    if let Some(volume_path) = mounted_volume_path(drive_id) {
        if run_diskutil(&["eject", &volume_path]).is_ok() {
            note_device_status_changed();
            return Ok(());
        }
    }

    if with_drive_lock(|| disc_recording::eject(drive_id)).unwrap_or(false) {
        note_device_status_changed();
        Ok(())
    } else {
        Err(format!("Failed to eject drive {drive_id}"))
    }
}

pub fn get_disc_info(drive_id: &str) -> Result<Option<CdDisc>, String> {
    // While playing, the Playing phase already blocks the monitor; entering
    // ReadingMetadata would clobber it and break the playback guard's reset.
    let _read_guard = (!is_playing(drive_id))
        .then(|| begin_phase(drive_id, DriveSessionPhase::ReadingMetadata));

    let toc_tracks = match read_disc_tracks_user(drive_id) {
        Ok(tracks) => tracks,
        Err(err) if err == "No audio CD in drive" => return Ok(None),
        Err(err) => return Err(err),
    };

    Ok(Some(build_disc_from_tracks(
        drive_id,
        &toc_tracks,
        None,
        None,
        &HashMap::new(),
    )))
}

fn cdtext_tuple(data: disc_recording::CdTextData) -> (Option<String>, Option<String>, HashMap<u32, String>) {
    (data.album, data.artist, data.track_titles)
}

fn read_cdtext_in_process(drive_id: &str) -> Option<(Option<String>, Option<String>, HashMap<u32, String>)> {
    with_drive_lock(|| disc_recording::read_cdtext(drive_id))
        .ok()
        .flatten()
        .map(cdtext_tuple)
}

fn read_cdtext_drutil(drive_id: &str) -> Option<(Option<String>, Option<String>, HashMap<u32, String>)> {
    let drutil_drive = disc_recording::drutil_drive_number(drive_id)?;
    let cdtext = with_drive_lock(|| {
        run_command(
            "/usr/bin/drutil",
            &["cdtext", "-drive", drutil_drive.as_str()],
        )
    })
    .ok()
    .and_then(|result| result.ok())?;
    let parsed = parse_cdtext(&cdtext);
    if parsed.0.is_none() && parsed.1.is_none() && parsed.2.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

fn read_cdtext(drive_id: &str) -> Option<(Option<String>, Option<String>, HashMap<u32, String>)> {
    read_cdtext_in_process(drive_id).or_else(|| read_cdtext_drutil(drive_id))
}

/// Background CD-Text read — merges into an existing disc on the frontend.
pub fn get_disc_cdtext(drive_id: &str) -> Result<Option<CdDiscCdText>, String> {
    let _read_guard = (!is_playing(drive_id))
        .then(|| begin_phase(drive_id, DriveSessionPhase::ReadingMetadata));

    let Some((album, artist, track_titles_map)) = read_cdtext(drive_id) else {
        return Ok(None);
    };

    if album.is_none() && artist.is_none() && track_titles_map.is_empty() {
        return Ok(None);
    }

    let mut track_titles: Vec<CdTrackTitle> = track_titles_map
        .into_iter()
        .map(|(number, title)| CdTrackTitle { number, title })
        .collect();
    track_titles.sort_by_key(|track| track.number);

    Ok(Some(CdDiscCdText {
        drive_id: drive_id.to_string(),
        album,
        artist,
        track_titles,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires audio CD with CD-Text in drive"]
    fn live_read_cdtext_in_process() {
        let drives = list_drives().expect("list_drives");
        let with_disc: Vec<_> = drives
            .iter()
            .filter(|drive| probe_disc_presence(&drive.id).unwrap_or(false))
            .collect();
        assert!(!with_disc.is_empty(), "expected a drive with disc");
        let drive = &with_disc[0];
        let cdtext = get_disc_cdtext(&drive.id).expect("get_disc_cdtext");
        let cdtext = cdtext.expect("expected CD-Text");
        eprintln!("cdtext: album={:?} artist={:?} tracks={}", cdtext.album, cdtext.artist, cdtext.track_titles.len());
        assert!(cdtext.album.is_some() || !cdtext.track_titles.is_empty());
    }

    #[test]
    #[ignore = "requires audio CD in drive"]
    fn live_list_and_read_disc() {
        let drives = list_drives().expect("list_drives");
        eprintln!("drives: {drives:?}");
        let with_disc: Vec<_> = drives
            .iter()
            .filter(|drive| probe_disc_presence(&drive.id).unwrap_or(false))
            .collect();
        assert!(!with_disc.is_empty(), "expected a drive with disc");
        for drive in with_disc {
            let disc = get_disc_info(&drive.id).expect("get_disc_info");
            eprintln!("disc for {}: {:?}", drive.id, disc.as_ref().map(|d| d.tracks.len()));
            let disc = disc.expect("disc should be Some");
            assert!(!disc.tracks.is_empty(), "expected tracks");
        }
    }

    #[test]
    fn bsd_name_from_device_identifier_strips_partition_suffix() {
        assert_eq!(
            bsd_name_from_device_identifier("disk4s0").as_deref(),
            Some("disk4")
        );
        assert_eq!(
            bsd_name_from_device_identifier("disk12").as_deref(),
            Some("disk12")
        );
        assert_eq!(
            bsd_name_from_device_identifier("disk12s2").as_deref(),
            Some("disk12")
        );
    }

    #[test]
    fn diskutil_info_detects_audio_cd() {
        let info = r#"   Device Identifier:         disk4s0
   Volume Name:               Audio CD
   Media Type:                CD-ROM
   Removable Media:           Yes
   Protocol:                  USB"#;
        assert!(diskutil_info_indicates_optical_disc(info));
    }

    #[test]
    fn diskutil_info_ignores_apfs_volume() {
        let info = r#"   File System Personality:   APFS
   Media Type:                Generic
   Removable Media:           No"#;
        assert!(!diskutil_info_indicates_optical_disc(info));
    }

    #[test]
    fn parse_cdtext_reads_album_artist_and_track_titles() {
        let cdtext = r#"<plist>
<dict>
<key>Tracks</key>
<array>
<dict>
<key>DRCDTextTitleKey</key><string>My Album</string>
<key>DRCDTextPerformerKey</key><string>My Artist</string>
</dict>
<dict>
<key>DRCDTextTitleKey</key><string>First Song</string>
</dict>
<dict>
<key>DRCDTextTitleKey</key><string>Second Song</string>
</dict>
</array>
</dict>
</plist>"#;
        let (album, artist, titles) = parse_cdtext(cdtext);
        assert_eq!(album.as_deref(), Some("My Album"));
        assert_eq!(artist.as_deref(), Some("My Artist"));
        assert_eq!(titles.get(&1), Some(&"First Song".to_string()));
        assert_eq!(titles.get(&2), Some(&"Second Song".to_string()));
    }
}
