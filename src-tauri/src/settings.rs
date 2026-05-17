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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataBackupSettings {
    #[serde(default = "default_metadata_backups_enabled")]
    pub enabled: bool,
    #[serde(default = "default_metadata_backup_retention_days")]
    pub retention_days: u32,
}

fn default_metadata_backups_enabled() -> bool {
    true
}

fn default_metadata_backup_retention_days() -> u32 {
    crate::metadata_backup::DEFAULT_RETENTION_DAYS
}

impl Default for MetadataBackupSettings {
    fn default() -> Self {
        Self {
            enabled: default_metadata_backups_enabled(),
            retention_days: default_metadata_backup_retention_days(),
        }
    }
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
    #[serde(default)]
    pub metadata_backups: MetadataBackupSettings,
}

fn default_active_theme() -> String {
    DEFAULT_THEME_ID.to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            active_theme: default_active_theme(),
            library: LibrarySettings::default(),
            metadata_backups: MetadataBackupSettings::default(),
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
    pub metadata_backups_enabled: bool,
    pub metadata_backup_retention_days: u32,
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
    let app_settings = read_settings(app);
    let stored = app_settings.library.clone();
    let backups = app_settings.metadata_backups;
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
        metadata_backups_enabled: backups.enabled,
        metadata_backup_retention_days: backups.retention_days.clamp(
            crate::metadata_backup::MIN_RETENTION_DAYS,
            crate::metadata_backup::MAX_RETENTION_DAYS,
        ),
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata_backups_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata_backup_retention_days: Option<u32>,
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
    if let Some(enabled) = patch.metadata_backups_enabled {
        settings.metadata_backups.enabled = enabled;
    }
    if let Some(days) = patch.metadata_backup_retention_days {
        settings.metadata_backups.retention_days = days.clamp(
            crate::metadata_backup::MIN_RETENTION_DAYS,
            crate::metadata_backup::MAX_RETENTION_DAYS,
        );
    }

    write_settings(app, &settings)?;
    let resolved = resolved_library_settings(app);

    if let Err(e) = crate::metadata_backup::run_scheduled_cleanup(app) {
        eprintln!("metadata backup cleanup after settings save: {e}");
    }

    Ok(resolved)
}

pub fn metadata_backup_config(app: &AppHandle) -> crate::metadata_backup::MetadataBackupConfig {
    crate::metadata_backup::MetadataBackupConfig::from(&read_settings(app).metadata_backups)
}
