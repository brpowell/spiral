use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const DEFAULT_THEME_ID: &str = "Obsidian";
pub const SPIRAL_LIBRARY_DIR_NAME: &str = "Spiral Library";
pub const MEDIA_DIR_NAME: &str = "Media";
pub const DATABASE_FILE_NAME: &str = "Library.db";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_folder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database_path: Option<String>,
    #[serde(default = "default_auto_organize")]
    pub auto_organize: bool,
    #[serde(default = "default_import_mode")]
    pub import_mode: String,
}

fn default_auto_organize() -> bool {
    true
}

fn default_import_mode() -> String {
    "ask".to_string()
}

impl Default for LibrarySettings {
    fn default() -> Self {
        Self {
            media_folder: None,
            database_path: None,
            auto_organize: true,
            import_mode: default_import_mode(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_active_theme")]
    pub active_theme: String,
    #[serde(default)]
    pub library: LibrarySettings,
}

fn default_active_theme() -> String {
    DEFAULT_THEME_ID.to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            active_theme: default_active_theme(),
            library: LibrarySettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySettingsResponse {
    pub media_folder: String,
    pub database_path: String,
    pub auto_organize: bool,
    pub import_mode: String,
    pub default_media_folder: String,
    pub default_database_path: String,
    pub default_library_root: String,
}

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data directory: {e}"))
}

pub fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("settings.json"))
}

pub fn read_settings(app: &AppHandle) -> AppSettings {
    let path = match settings_path(app) {
        Ok(p) => p,
        Err(_) => return AppSettings::default(),
    };
    if !path.exists() {
        return AppSettings::default();
    }
    let contents = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("settings.json read error: {e}");
            return AppSettings::default();
        }
    };
    serde_json::from_str(&contents).unwrap_or_else(|e| {
        eprintln!("settings.json parse error: {e}");
        AppSettings::default()
    })
}

pub fn write_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create app data directory: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("failed to serialize settings: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("failed to write settings.json: {e}"))
}

pub fn music_base_dir(app: &AppHandle) -> PathBuf {
    if let Ok(audio) = app.path().audio_dir() {
        return audio;
    }
    if let Ok(home) = app.path().home_dir() {
        let music = home.join("Music");
        if music.is_dir() || !home.join("Music").exists() {
            return music;
        }
        return home;
    }
    PathBuf::from(".")
}

pub fn default_library_root(app: &AppHandle) -> PathBuf {
    music_base_dir(app).join(SPIRAL_LIBRARY_DIR_NAME)
}

pub fn default_media_folder(app: &AppHandle) -> PathBuf {
    default_library_root(app).join(MEDIA_DIR_NAME)
}

pub fn default_database_path(app: &AppHandle) -> PathBuf {
    default_library_root(app).join(DATABASE_FILE_NAME)
}

pub fn resolved_library_settings(app: &AppHandle) -> LibrarySettingsResponse {
    let stored = read_settings(app).library;
    let default_root = default_library_root(app);
    let default_media = default_media_folder(app);
    let default_db = default_database_path(app);

    let media_folder = stored
        .media_folder
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_media.to_string_lossy().into_owned());

    let database_path = stored
        .database_path
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_db.to_string_lossy().into_owned());

    LibrarySettingsResponse {
        media_folder,
        database_path,
        auto_organize: stored.auto_organize,
        import_mode: stored.import_mode,
        default_media_folder: default_media.to_string_lossy().into_owned(),
        default_database_path: default_db.to_string_lossy().into_owned(),
        default_library_root: default_root.to_string_lossy().into_owned(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySettingsPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_folder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_organize: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import_mode: Option<String>,
}

pub fn merge_library_settings(
    app: &AppHandle,
    patch: LibrarySettingsPatch,
) -> Result<LibrarySettingsResponse, String> {
    let mut settings = read_settings(app);

    if let Some(media_folder) = patch.media_folder {
        if media_folder.trim().is_empty() {
            settings.library.media_folder = None;
        } else {
            settings.library.media_folder = Some(media_folder);
        }
    }
    if let Some(database_path) = patch.database_path {
        if database_path.trim().is_empty() {
            settings.library.database_path = None;
        } else {
            settings.library.database_path = Some(database_path);
        }
    }
    if let Some(auto_organize) = patch.auto_organize {
        settings.library.auto_organize = auto_organize;
    }
    if let Some(import_mode) = patch.import_mode {
        if !import_mode.is_empty() {
            settings.library.import_mode = import_mode;
        }
    }

    write_settings(app, &settings)?;
    Ok(resolved_library_settings(app))
}
