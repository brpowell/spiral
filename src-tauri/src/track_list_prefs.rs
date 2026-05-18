use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use tauri::AppHandle;

use crate::settings;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrackListPreferences {
    #[serde(default)]
    pub column_widths: HashMap<String, u32>,
    #[serde(default)]
    pub hidden_columns: Vec<String>,
}

pub fn preferences_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(settings::app_data_dir(app)?.join("track-list-preferences.json"))
}

pub fn read_preferences(app: &AppHandle) -> Option<TrackListPreferences> {
    let path = preferences_path(app).ok()?;
    if !path.exists() {
        return None;
    }
    let contents = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&contents).ok()
}

pub fn write_preferences(app: &AppHandle, preferences: &TrackListPreferences) -> Result<(), String> {
    let path = preferences_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create app data directory: {e}"))?;
    }
    let json = serde_json::to_string_pretty(preferences)
        .map_err(|e| format!("failed to serialize track list preferences: {e}"))?;
    fs::write(&path, json)
        .map_err(|e| format!("failed to write track list preferences: {e}"))
}
