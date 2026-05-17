use crate::settings;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    pub name: String,
    pub author: String,
    pub description: String,
    pub tokens: HashMap<String, String>,
}

const BUILTIN_THEMES: &[&str] = &[
    include_str!("../../themes/builtin/obsidian.theme.json"),
    include_str!("../../themes/builtin/parchment.theme.json"),
    include_str!("../../themes/builtin/noir.theme.json"),
    include_str!("../../themes/builtin/grove.theme.json"),
];

fn themes_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(settings::app_data_dir(app)?.join("themes"))
}

fn ensure_themes_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = themes_dir(app)?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("failed to create themes directory: {e}"))?;
    }
    Ok(dir)
}

fn parse_theme_file(path: &Path, contents: &str) -> Option<Theme> {
    match serde_json::from_str::<Theme>(contents) {
        Ok(theme) => Some(theme),
        Err(e) => {
            eprintln!("theme parse error for {}: {e}", path.display());
            None
        }
    }
}

#[tauri::command]
pub fn get_builtin_themes() -> Result<Vec<Theme>, String> {
    let mut themes = Vec::with_capacity(BUILTIN_THEMES.len());
    for json in BUILTIN_THEMES {
        let theme: Theme = serde_json::from_str(json)
            .map_err(|e| format!("failed to parse built-in theme: {e}"))?;
        themes.push(theme);
    }
    Ok(themes)
}

#[tauri::command]
pub fn load_user_themes(app: AppHandle) -> Result<Vec<Theme>, String> {
    let dir = themes_dir(&app)?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut themes = Vec::new();
    let entries =
        fs::read_dir(&dir).map_err(|e| format!("failed to read themes directory: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !file_name.ends_with(".theme.json") {
            continue;
        }
        let contents = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("theme read error for {}: {e}", path.display());
                continue;
            }
        };
        if let Some(theme) = parse_theme_file(&path, &contents) {
            themes.push(theme);
        }
    }

    themes.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(themes)
}

#[tauri::command]
pub fn save_active_theme_id(app: AppHandle, theme_name: String) -> Result<(), String> {
    let mut app_settings = settings::read_settings(&app);
    app_settings.active_theme = theme_name;
    settings::write_settings(&app, &app_settings)
}

#[tauri::command]
pub fn get_active_theme_id(app: AppHandle) -> Result<String, String> {
    Ok(settings::read_settings(&app).active_theme)
}

#[tauri::command]
pub fn open_themes_folder(app: AppHandle) -> Result<(), String> {
    let dir = ensure_themes_dir(&app)?;
    app.opener()
        .open_path(dir.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| format!("failed to open themes folder: {e}"))
}

#[tauri::command]
pub fn import_user_theme(app: AppHandle) -> Result<Option<Theme>, String> {
    let source = rfd::FileDialog::new()
        .set_title("Import theme")
        .add_filter("Theme JSON", &["json", "theme.json"])
        .pick_file();

    let source = match source {
        Some(p) => p,
        None => return Ok(None),
    };

    let file_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "invalid theme file name".to_string())?;

    let dest_name = if file_name.ends_with(".theme.json") {
        file_name.to_string()
    } else if file_name.ends_with(".json") {
        format!("{}.theme.json", file_name.trim_end_matches(".json"))
    } else {
        format!("{file_name}.theme.json")
    };

    let dir = ensure_themes_dir(&app)?;
    let dest = dir.join(&dest_name);

    fs::copy(&source, &dest).map_err(|e| format!("failed to copy theme file: {e}"))?;

    let contents =
        fs::read_to_string(&dest).map_err(|e| format!("failed to read imported theme: {e}"))?;

    parse_theme_file(&dest, &contents)
        .ok_or_else(|| "imported theme file is not valid JSON".to_string())
        .map(Some)
}
