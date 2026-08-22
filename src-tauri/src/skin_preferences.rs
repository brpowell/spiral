use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use tauri::AppHandle;

use crate::settings;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkinBuiltinPreferences {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound_effects_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkinUserPreferences {
    #[serde(default)]
    pub builtin: SkinBuiltinPreferences,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub custom: HashMap<String, Value>,
}

type AllSkinPreferences = HashMap<String, SkinUserPreferences>;

pub fn preferences_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(settings::app_data_dir(app)?.join("skin-preferences.json"))
}

fn read_all(app: &AppHandle) -> AllSkinPreferences {
    let path = match preferences_path(app) {
        Ok(path) => path,
        Err(_) => return HashMap::new(),
    };
    if !path.exists() {
        return HashMap::new();
    }
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(_) => return HashMap::new(),
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_all(app: &AppHandle, preferences: &AllSkinPreferences) -> Result<(), String> {
    let path = preferences_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create app data directory: {e}"))?;
    }
    let json = serde_json::to_string_pretty(preferences)
        .map_err(|e| format!("failed to serialize skin preferences: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("failed to write skin preferences: {e}"))
}

pub fn read_preferences(app: &AppHandle, skin_id: &str) -> SkinUserPreferences {
    read_all(app).remove(skin_id).unwrap_or_default()
}

pub fn write_preferences(
    app: &AppHandle,
    skin_id: &str,
    preferences: &SkinUserPreferences,
) -> Result<(), String> {
    let mut all = read_all(app);
    all.insert(skin_id.to_string(), preferences.clone());
    write_all(app, &all)
}
