use crate::cd::platform;
use crate::cd::playback;
use crate::cd::playback::CdPlaybackStarted;
use crate::cd::{cleanup_rip_temp, rip_cd_track as rip_cd_track_impl};
use crate::cd::types::{CdDisc, CdDiscCdText, CdDrive};
use crate::disc_metadata_cache::{
    self, DiscMetadataCachePeek, DiscMetadataOverride,
};
use crate::models::TrackMetadataUpdate;
use crate::musicbrainz_disc::DiscMetadataLookup;
use crate::activity_log::{self, ActivityLogContext};
use serde::Deserialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscTocTrack {
    number: u32,
    duration_seconds: f64,
}

fn toc_tracks_from_disc(disc: &CdDisc) -> Vec<(u32, f64)> {
    disc.tracks
        .iter()
        .filter_map(|track| {
            track
                .duration_seconds
                .map(|duration| (track.number, duration))
        })
        .collect()
}

fn toc_tracks_from_payload(tracks: &[DiscTocTrack]) -> Vec<(u32, f64)> {
    tracks
        .iter()
        .map(|track| (track.number, track.duration_seconds))
        .collect()
}

fn resolve_toc_tracks(drive_id: &str, tracks: Option<Vec<DiscTocTrack>>) -> Result<Vec<(u32, f64)>, String> {
    if let Some(tracks) = tracks {
        let toc = toc_tracks_from_payload(&tracks);
        if !toc.is_empty() {
            return Ok(toc);
        }
    }

    let disc = platform::get_disc_info(drive_id)?
        .ok_or_else(|| "No audio CD in drive".to_string())?;
    Ok(toc_tracks_from_disc(&disc))
}

#[tauri::command]
pub async fn list_cd_drives() -> Result<Vec<CdDrive>, String> {
    tauri::async_runtime::spawn_blocking(platform::list_drives)
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn probe_cd_drive(drive_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || platform::probe_disc_presence(&drive_id))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn get_disc_info(drive_id: String) -> Result<Option<CdDisc>, String> {
    tauri::async_runtime::spawn_blocking(move || platform::get_disc_info(&drive_id))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn get_disc_cdtext(drive_id: String) -> Result<Option<CdDiscCdText>, String> {
    tauri::async_runtime::spawn_blocking(move || platform::get_disc_cdtext(&drive_id))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn eject_cd_disc(drive_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || platform::eject_disc(&drive_id))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn set_cd_detail_drive(drive_id: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        platform::set_detail_view_drive(drive_id.as_deref());
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn start_cd_playback(
    app: AppHandle,
    drive_id: String,
    track_number: u32,
) -> Result<CdPlaybackStarted, String> {
    tauri::async_runtime::spawn_blocking(move || playback::start(app, &drive_id, track_number))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn pause_cd_playback(session_id: u64) {
    playback::pause(session_id);
}

#[tauri::command]
pub fn resume_cd_playback(session_id: u64) {
    playback::resume(session_id);
}

#[tauri::command]
pub fn seek_cd_playback(session_id: u64, position_seconds: f64) -> Result<(), String> {
    playback::seek(session_id, position_seconds)
}

#[tauri::command]
pub fn stop_cd_playback(session_id: u64) {
    playback::stop(session_id);
}

#[tauri::command]
pub fn ack_cd_playback_pcm(session_id: u64, count: u32) {
    playback::ack_pcm_chunks(session_id, count);
}

#[tauri::command]
pub async fn peek_disc_metadata_cache(
    app: AppHandle,
    drive_id: String,
    tracks: Option<Vec<DiscTocTrack>>,
    log_context: Option<ActivityLogContext>,
) -> Result<DiscMetadataCachePeek, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(ctx) = log_context {
            activity_log::set_thread_context(ctx);
        }
        let result = (|| {
            let toc_tracks = resolve_toc_tracks(&drive_id, tracks)?;
            disc_metadata_cache::peek_disc_metadata_cache(&app, &toc_tracks)
        })();
        activity_log::clear_thread_context();
        result
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn lookup_disc_metadata(
    app: AppHandle,
    drive_id: String,
    tracks: Option<Vec<DiscTocTrack>>,
    force_refresh: Option<bool>,
    log_context: Option<ActivityLogContext>,
) -> Result<DiscMetadataLookup, String> {
    let force = force_refresh.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(ctx) = log_context {
            activity_log::set_thread_context(ctx);
        }
        let result = (|| {
            let toc_tracks = resolve_toc_tracks(&drive_id, tracks)?;
            disc_metadata_cache::lookup_disc_metadata_cached_with_options(
                &app,
                &toc_tracks,
                force,
            )
        })();
        activity_log::clear_thread_context();
        result
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn save_disc_metadata_preference(
    app: AppHandle,
    disc_id: String,
    release_mbid: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        disc_metadata_cache::save_disc_metadata_preference(&app, &disc_id, &release_mbid)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn get_disc_metadata_override(
    app: AppHandle,
    disc_id: String,
) -> Result<Option<DiscMetadataOverride>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        disc_metadata_cache::get_disc_metadata_override(&app, &disc_id)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn save_disc_metadata_override(
    app: AppHandle,
    disc_id: String,
    patch: DiscMetadataOverride,
) -> Result<DiscMetadataOverride, String> {
    tauri::async_runtime::spawn_blocking(move || {
        disc_metadata_cache::save_disc_metadata_override(&app, &disc_id, patch)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn clear_disc_metadata_override(
    app: AppHandle,
    disc_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        disc_metadata_cache::clear_disc_metadata_override(&app, &disc_id)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn rip_cd_track(
    drive_id: String,
    track_number: u32,
    profile_id: String,
    metadata: TrackMetadataUpdate,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rip_cd_track_impl(&drive_id, track_number, &profile_id, &metadata)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn cleanup_cd_rip_temp(drive_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        cleanup_rip_temp(&drive_id);
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}
