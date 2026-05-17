use super::library::DbState;
use crate::art_cache::{self, guess_ext_from_url};
use crate::db;
use crate::metadata_writer;
use crate::models::{Track, TrackMetadataUpdate};
use std::path::Path;
use tauri::{AppHandle, Manager, State};

const MUSICBRAINZ_USER_AGENT: &str = "Spiral/0.1.0 (https://github.com/brpowell/spiral)";

#[tauri::command]
pub fn pick_image_file() -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .set_title("Select album art")
        .add_filter(
            "Images",
            &["jpg", "jpeg", "png", "webp", "JPG", "JPEG", "PNG", "WEBP"],
        )
        .pick_file();

    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn cache_art_from_file(
    app: AppHandle,
    source_path: String,
    file_path: String,
) -> Result<String, String> {
    let app_data = app_data_dir(&app)?;
    let dest = art_cache::copy_to_art_cache(&app_data, &file_path, Path::new(&source_path))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn cache_art_from_bytes(
    app: AppHandle,
    bytes: Vec<u8>,
    file_path: String,
    format: String,
) -> Result<String, String> {
    let ext = art_cache::ext_from_mime(&format);
    let app_data = app_data_dir(&app)?;
    let dest = art_cache::write_bytes_to_art_cache(&app_data, &file_path, &bytes, ext)?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn cache_art_from_url(
    app: AppHandle,
    url: String,
    file_path: String,
) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(MUSICBRAINZ_USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .map_err(|e| format!("Failed to download cover art: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download cover art (HTTP {})",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .map_err(|e| format!("Failed to read cover art: {e}"))?;

    let ext = guess_ext_from_url(&url);
    let app_data = app_data_dir(&app)?;
    let dest = art_cache::write_bytes_to_art_cache(&app_data, &file_path, &bytes, ext)?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn fetch_cover_art(artist: String, album: String) -> Result<Vec<String>, String> {
    if artist.trim().is_empty() && album.trim().is_empty() {
        return Ok(vec![]);
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent(MUSICBRAINZ_USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;

    let query = format!(
        "release:\"{}\" AND artist:\"{}\"",
        album.replace('"', "\\\""),
        artist.replace('"', "\\\"")
    );
    let search_url = format!(
        "https://musicbrainz.org/ws/2/release?query={}&fmt=json&limit=5",
        urlencoding_simple(&query)
    );

    let search: serde_json::Value = match client.get(&search_url).send() {
        Ok(resp) if resp.status().is_success() => resp.json().unwrap_or(serde_json::Value::Null),
        _ => return Ok(vec![]),
    };

    let releases = search
        .get("releases")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    let mut urls = Vec::new();

    for release in releases {
        if urls.len() >= 5 {
            break;
        }
        let Some(mbid) = release.get("id").and_then(|id| id.as_str()) else {
            continue;
        };

        let caa_url = format!("https://coverartarchive.org/release/{mbid}");
        let caa: serde_json::Value = match client.get(&caa_url).send() {
            Ok(resp) if resp.status().is_success() => {
                resp.json().unwrap_or(serde_json::Value::Null)
            }
            _ => continue,
        };

        let Some(images) = caa.get("images").and_then(|i| i.as_array()) else {
            continue;
        };

        for image in images {
            if urls.len() >= 5 {
                break;
            }
            let types = image
                .get("types")
                .and_then(|t| t.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>())
                .unwrap_or_default();

            let is_front =
                types.iter().any(|t| t.eq_ignore_ascii_case("front")) || types.is_empty();

            if !is_front {
                continue;
            }

            if let Some(url) = image.get("image").and_then(|u| u.as_str()) {
                if !urls.contains(&url.to_string()) {
                    urls.push(url.to_string());
                }
            }
        }
    }

    Ok(urls)
}

#[tauri::command]
pub fn write_track_metadata(
    app: AppHandle,
    state: State<DbState>,
    track_id: i64,
    file_path: String,
    metadata: TrackMetadataUpdate,
) -> Result<Track, String> {
    let path = Path::new(&file_path);

    metadata_writer::write_track_metadata(path, &metadata).map_err(|e| e.to_message())?;

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::update_track(&conn, track_id, &metadata).map_err(|e| {
        eprintln!("update_track error: {e}");
        e.to_string()
    })?;

    let track = db::get_track_by_id(&conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track {track_id} not found after update"))?;

    let _ = app;
    Ok(track)
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn urlencoding_simple(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
