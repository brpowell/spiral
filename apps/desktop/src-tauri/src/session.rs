use serde::{Deserialize, Serialize};
use std::fs;
use tauri::AppHandle;

use crate::settings;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSession {
    #[serde(default)]
    pub play_context_ids: Vec<i64>,
    #[serde(default)]
    pub manual_queue_ids: Vec<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_track_id: Option<i64>,
    #[serde(default)]
    pub position_seconds: f64,
    #[serde(default)]
    pub shuffle: bool,
    #[serde(default = "default_repeat_mode")]
    pub repeat_mode: String,
}

fn default_repeat_mode() -> String {
    "off".to_string()
}

pub fn session_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(settings::app_data_dir(app)?.join("playback-session.json"))
}

pub fn read_session(app: &AppHandle) -> Option<PlaybackSession> {
    let path = session_path(app).ok()?;
    if !path.exists() {
        return None;
    }
    let contents = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&contents).ok()
}

pub fn write_session(app: &AppHandle, session: &PlaybackSession) -> Result<(), String> {
    let path = session_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create app data directory: {e}"))?;
    }
    let json = serde_json::to_string_pretty(session)
        .map_err(|e| format!("failed to serialize playback session: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("failed to write playback session: {e}"))
}
