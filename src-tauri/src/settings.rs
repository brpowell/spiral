use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const DEFAULT_THEME_ID: &str = "Obsidian";
pub const DEFAULT_SKIN_ID: &str = "spiral-default";
pub const DEFAULT_VISUALIZER_ID: &str = "bars";
pub const DEFAULT_SKIN_VIEW_ID: &str = "standard";
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
    /// When set, controls the full relative path under the media folder.
    #[serde(default)]
    pub organize_path_format: Option<String>,
    /// Legacy: filename-only format before `organize_path_format` existed.
    #[serde(default = "default_track_filename_format")]
    pub track_filename_format: String,
}

fn default_track_filename_format() -> String {
    crate::library_organize::default_track_filename_format()
}

fn default_organize_path_format() -> String {
    crate::library_organize::default_organize_path_format()
}

pub fn resolved_organize_path_format(stored: &LibrarySettings) -> String {
    if let Some(fmt) = &stored.organize_path_format {
        if !fmt.trim().is_empty() {
            return fmt.clone();
        }
    }
    let legacy = stored.track_filename_format.trim();
    if !legacy.is_empty()
        && legacy != crate::library_organize::DEFAULT_TRACK_FILENAME_FORMAT
    {
        return format!("{{albumArtist}}/{{album}}/{legacy}.{{ext}}");
    }
    default_organize_path_format()
}

fn default_auto_organize() -> bool {
    true
}

fn default_import_mode() -> String {
    "ask".to_string()
}

fn default_cd_metadata_fetch_mode() -> String {
    "ask".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CdSettings {
    #[serde(default = "default_cd_metadata_fetch_mode")]
    pub metadata_fetch_mode: String,
}

impl Default for CdSettings {
    fn default() -> Self {
        Self {
            metadata_fetch_mode: default_cd_metadata_fetch_mode(),
        }
    }
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
            organize_path_format: None,
            track_filename_format: default_track_filename_format(),
        }
    }
}

fn default_equalizer_enabled() -> bool {
    true
}

fn default_equalizer_preset_id() -> String {
    "flat".to_string()
}

fn default_equalizer_bands() -> [f32; 10] {
    [0.0; 10]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqualizerSettings {
    #[serde(default = "default_equalizer_enabled")]
    pub enabled: bool,
    #[serde(default = "default_equalizer_preset_id")]
    pub preset_id: String,
    #[serde(default = "default_equalizer_bands")]
    pub bands: [f32; 10],
}

impl Default for EqualizerSettings {
    fn default() -> Self {
        Self {
            enabled: default_equalizer_enabled(),
            preset_id: default_equalizer_preset_id(),
            bands: default_equalizer_bands(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_active_theme")]
    pub active_theme: String,
    #[serde(default = "default_active_skin")]
    pub active_skin: String,
    #[serde(default = "default_active_skin_view")]
    pub active_skin_view: String,
    #[serde(default = "default_active_visualizer")]
    pub active_visualizer: String,
    #[serde(default)]
    pub library: LibrarySettings,
    #[serde(default)]
    pub metadata_backups: MetadataBackupSettings,
    #[serde(default)]
    pub cd: CdSettings,
    #[serde(default)]
    pub equalizer: EqualizerSettings,
}

fn default_active_theme() -> String {
    DEFAULT_THEME_ID.to_string()
}

fn default_active_skin() -> String {
    DEFAULT_SKIN_ID.to_string()
}

fn default_active_skin_view() -> String {
    DEFAULT_SKIN_VIEW_ID.to_string()
}

fn default_active_visualizer() -> String {
    DEFAULT_VISUALIZER_ID.to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            active_theme: default_active_theme(),
            active_skin: default_active_skin(),
            active_skin_view: default_active_skin_view(),
            active_visualizer: default_active_visualizer(),
            library: LibrarySettings::default(),
            metadata_backups: MetadataBackupSettings::default(),
            cd: CdSettings::default(),
            equalizer: EqualizerSettings::default(),
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
    pub organize_path_format: String,
    pub default_organize_path_format: String,
    pub default_media_folder: String,
    pub default_database_path: String,
    pub default_library_root: String,
    pub metadata_backups_enabled: bool,
    pub metadata_backup_retention_days: u32,
    pub cd_metadata_fetch_mode: String,
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
    let cd = app_settings.cd;
    let default_root = default_library_root(app);
    let default_media = default_media_folder(app);
    let default_db = default_database_path(app);

    let organize_path_format = resolved_organize_path_format(&stored);

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
        organize_path_format,
        default_organize_path_format: default_organize_path_format(),
        default_media_folder: default_media.to_string_lossy().into_owned(),
        default_database_path: default_db.to_string_lossy().into_owned(),
        default_library_root: default_root.to_string_lossy().into_owned(),
        metadata_backups_enabled: backups.enabled,
        metadata_backup_retention_days: backups.retention_days.clamp(
            crate::metadata_backup::MIN_RETENTION_DAYS,
            crate::metadata_backup::MAX_RETENTION_DAYS,
        ),
        cd_metadata_fetch_mode: cd.metadata_fetch_mode,
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
    pub organize_path_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata_backups_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata_backup_retention_days: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cd_metadata_fetch_mode: Option<String>,
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
    if let Some(organize_path_format) = patch.organize_path_format {
        settings.library.organize_path_format = Some(if organize_path_format.trim().is_empty() {
            default_organize_path_format()
        } else {
            organize_path_format
        });
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
    if let Some(mode) = patch.cd_metadata_fetch_mode {
        if !mode.is_empty() {
            settings.cd.metadata_fetch_mode = mode;
        }
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
