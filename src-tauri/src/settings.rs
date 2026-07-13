use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const DEFAULT_THEME_ID: &str = "obsidian";
pub const DEFAULT_SKIN_ID: &str = "spiral-default";
pub const DEFAULT_VISUALIZER_ID: &str = "bars";
pub const DEFAULT_SKIN_VIEW_ID: &str = "standard";
pub const SPIRAL_LIBRARY_DIR_NAME: &str = "Spiral Library";
pub const MEDIA_DIR_NAME: &str = "Media";
pub const DATABASE_FILE_NAME: &str = "Library.db";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySettings {
    /// Root directory for the Spiral library (`Media/` + `Library.db` live here).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library_root: Option<String>,
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

fn default_cd_import_profile_id() -> String {
    crate::encoding_profiles::DEFAULT_CD_IMPORT_PROFILE_ID.to_string()
}

fn resolved_cd_import_profile_id(stored: &str) -> String {
    if crate::encoding_profiles::profile_from_id(stored).is_ok() {
        stored.to_string()
    } else {
        default_cd_import_profile_id()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CdSettings {
    #[serde(default = "default_cd_metadata_fetch_mode")]
    pub metadata_fetch_mode: String,
    #[serde(default = "default_cd_import_profile_id")]
    pub import_profile_id: String,
}

impl Default for CdSettings {
    fn default() -> Self {
        Self {
            metadata_fetch_mode: default_cd_metadata_fetch_mode(),
            import_profile_id: default_cd_import_profile_id(),
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningHistorySettings {
    #[serde(default = "default_listening_history_enabled")]
    pub enabled: bool,
}

fn default_listening_history_enabled() -> bool {
    true
}

impl Default for ListeningHistorySettings {
    fn default() -> Self {
        Self {
            enabled: default_listening_history_enabled(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsSettings {
    #[serde(default = "default_lyrics_sidecar_sync_enabled")]
    pub sidecar_sync_enabled: bool,
    #[serde(default = "default_lyrics_auto_fetch_in_lightbox")]
    pub auto_fetch_in_lightbox: bool,
}

fn default_lyrics_sidecar_sync_enabled() -> bool {
    true
}

fn default_lyrics_auto_fetch_in_lightbox() -> bool {
    true
}

impl Default for LyricsSettings {
    fn default() -> Self {
        Self {
            sidecar_sync_enabled: default_lyrics_sidecar_sync_enabled(),
            auto_fetch_in_lightbox: default_lyrics_auto_fetch_in_lightbox(),
        }
    }
}

impl Default for LibrarySettings {
    fn default() -> Self {
        Self {
            library_root: None,
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

fn default_equalizer_preamp_gain() -> f32 {
    0.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqualizerPresetRecord {
    pub id: String,
    pub name: String,
    pub bands: [f32; 10],
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
    #[serde(default = "default_equalizer_preamp_gain")]
    pub preamp_gain: f32,
    #[serde(default)]
    pub custom_presets: Vec<EqualizerPresetRecord>,
}

impl Default for EqualizerSettings {
    fn default() -> Self {
        Self {
            enabled: default_equalizer_enabled(),
            preset_id: default_equalizer_preset_id(),
            bands: default_equalizer_bands(),
            preamp_gain: default_equalizer_preamp_gain(),
            custom_presets: Vec::new(),
        }
    }
}

fn default_crossfade_enabled() -> bool {
    false
}

fn default_crossfade_seconds() -> u32 {
    7
}

fn default_crossfade_on_skip() -> bool {
    false
}

fn default_crossfade_visual_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSettings {
    #[serde(default = "default_crossfade_enabled")]
    pub crossfade_enabled: bool,
    #[serde(default = "default_crossfade_seconds")]
    pub crossfade_seconds: u32,
    #[serde(default = "default_crossfade_on_skip")]
    pub crossfade_on_skip: bool,
    #[serde(default = "default_crossfade_visual_enabled")]
    pub crossfade_visual_enabled: bool,
}

impl Default for PlaybackSettings {
    fn default() -> Self {
        Self {
            crossfade_enabled: default_crossfade_enabled(),
            crossfade_seconds: default_crossfade_seconds(),
            crossfade_on_skip: default_crossfade_on_skip(),
            crossfade_visual_enabled: default_crossfade_visual_enabled(),
        }
    }
}

pub const MIN_CROSSFADE_SECONDS: u32 = 1;
pub const MAX_CROSSFADE_SECONDS: u32 = 12;

pub fn normalize_playback_settings(settings: PlaybackSettings) -> PlaybackSettings {
    PlaybackSettings {
        crossfade_enabled: settings.crossfade_enabled,
        crossfade_seconds: settings
            .crossfade_seconds
            .clamp(MIN_CROSSFADE_SECONDS, MAX_CROSSFADE_SECONDS),
        crossfade_on_skip: settings.crossfade_on_skip,
        crossfade_visual_enabled: settings.crossfade_visual_enabled,
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
    pub listening_history: ListeningHistorySettings,
    #[serde(default)]
    pub lyrics: LyricsSettings,
    #[serde(default)]
    pub cd: CdSettings,
    #[serde(default)]
    pub equalizer: EqualizerSettings,
    #[serde(default)]
    pub playback: PlaybackSettings,
    #[serde(default)]
    pub acknowledged_crash_report_ids: Vec<String>,
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
            listening_history: ListeningHistorySettings::default(),
            lyrics: LyricsSettings::default(),
            cd: CdSettings::default(),
            equalizer: EqualizerSettings::default(),
            playback: PlaybackSettings::default(),
            acknowledged_crash_report_ids: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySettingsResponse {
    pub library_root: String,
    pub media_folder: String,
    pub database_path: String,
    pub auto_organize: bool,
    pub import_mode: String,
    pub organize_path_format: String,
    pub default_organize_path_format: String,
    pub default_library_root: String,
    pub metadata_backups_enabled: bool,
    pub metadata_backup_retention_days: u32,
    pub listening_history_enabled: bool,
    pub lyrics_sidecar_sync_enabled: bool,
    pub lyrics_auto_fetch_in_lightbox: bool,
    pub cd_metadata_fetch_mode: String,
    pub cd_import_profile_id: String,
}

const MAX_ACKNOWLEDGED_CRASH_REPORTS: usize = 50;

pub fn is_crash_report_acknowledged(app: &AppHandle, id: &str) -> bool {
    read_settings(app)
        .acknowledged_crash_report_ids
        .iter()
        .any(|stored| stored == id)
}

pub fn push_acknowledged_crash_report_id(app: &AppHandle, id: &str) -> Result<(), String> {
    let mut settings = read_settings(app);
    if settings.acknowledged_crash_report_ids.iter().any(|stored| stored == id) {
        return Ok(());
    }

    settings.acknowledged_crash_report_ids.push(id.to_string());
    if settings.acknowledged_crash_report_ids.len() > MAX_ACKNOWLEDGED_CRASH_REPORTS {
        let drain = settings
            .acknowledged_crash_report_ids
            .len()
            .saturating_sub(MAX_ACKNOWLEDGED_CRASH_REPORTS);
        settings.acknowledged_crash_report_ids.drain(0..drain);
    }

    write_settings(app, &settings)
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

pub fn media_folder_for_root(library_root: &Path) -> PathBuf {
    library_root.join(MEDIA_DIR_NAME)
}

pub fn database_path_for_root(library_root: &Path) -> PathBuf {
    library_root.join(DATABASE_FILE_NAME)
}

pub fn resolved_library_settings(app: &AppHandle) -> LibrarySettingsResponse {
    let app_settings = read_settings(app);
    let stored = app_settings.library.clone();
    let backups = app_settings.metadata_backups;
    let listening_history = app_settings.listening_history;
    let lyrics = app_settings.lyrics;
    let cd = app_settings.cd;
    let default_root = default_library_root(app);

    let organize_path_format = resolved_organize_path_format(&stored);

    let library_root = stored
        .library_root
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_root.to_string_lossy().into_owned());
    let root_path = Path::new(&library_root);
    let media_folder = media_folder_for_root(root_path)
        .to_string_lossy()
        .into_owned();
    let database_path = database_path_for_root(root_path)
        .to_string_lossy()
        .into_owned();

    LibrarySettingsResponse {
        library_root,
        media_folder,
        database_path,
        auto_organize: stored.auto_organize,
        import_mode: stored.import_mode,
        organize_path_format,
        default_organize_path_format: default_organize_path_format(),
        default_library_root: default_root.to_string_lossy().into_owned(),
        metadata_backups_enabled: backups.enabled,
        metadata_backup_retention_days: backups.retention_days.clamp(
            crate::metadata_backup::MIN_RETENTION_DAYS,
            crate::metadata_backup::MAX_RETENTION_DAYS,
        ),
        listening_history_enabled: listening_history.enabled,
        lyrics_sidecar_sync_enabled: lyrics.sidecar_sync_enabled,
        lyrics_auto_fetch_in_lightbox: lyrics.auto_fetch_in_lightbox,
        cd_metadata_fetch_mode: cd.metadata_fetch_mode,
        cd_import_profile_id: resolved_cd_import_profile_id(&cd.import_profile_id),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySettingsPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library_root: Option<String>,
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
    pub listening_history_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lyrics_sidecar_sync_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lyrics_auto_fetch_in_lightbox: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cd_metadata_fetch_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cd_import_profile_id: Option<String>,
}

pub fn merge_library_settings(
    app: &AppHandle,
    patch: LibrarySettingsPatch,
) -> Result<LibrarySettingsResponse, String> {
    let mut settings = read_settings(app);

    if let Some(library_root) = patch.library_root {
        if library_root.trim().is_empty() {
            settings.library.library_root = None;
        } else {
            settings.library.library_root = Some(library_root);
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
    if let Some(enabled) = patch.listening_history_enabled {
        settings.listening_history.enabled = enabled;
    }
    if let Some(enabled) = patch.lyrics_sidecar_sync_enabled {
        settings.lyrics.sidecar_sync_enabled = enabled;
    }
    if let Some(enabled) = patch.lyrics_auto_fetch_in_lightbox {
        settings.lyrics.auto_fetch_in_lightbox = enabled;
    }
    if let Some(mode) = patch.cd_metadata_fetch_mode {
        if !mode.is_empty() {
            settings.cd.metadata_fetch_mode = mode;
        }
    }
    if let Some(profile_id) = patch.cd_import_profile_id {
        if !profile_id.is_empty() {
            crate::encoding_profiles::profile_from_id(&profile_id)?;
            settings.cd.import_profile_id = profile_id;
        }
    }

    write_settings(app, &settings)?;
    let resolved = resolved_library_settings(app);

    if let Err(e) = crate::metadata_backup::run_scheduled_cleanup(app) {
        eprintln!("metadata backup cleanup after settings save: {e}");
    }

    Ok(resolved)
}

pub fn listening_history_enabled(app: &AppHandle) -> bool {
    read_settings(app).listening_history.enabled
}

pub fn metadata_backup_config(app: &AppHandle) -> crate::metadata_backup::MetadataBackupConfig {
    crate::metadata_backup::MetadataBackupConfig::from(&read_settings(app).metadata_backups)
}

pub fn lyrics_sidecar_sync_enabled(app: &AppHandle) -> bool {
    read_settings(app).lyrics.sidecar_sync_enabled
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_listening_history_settings_are_enabled() {
        let settings = ListeningHistorySettings::default();
        assert!(settings.enabled);
    }

    #[test]
    fn default_lyrics_settings_enable_sidecar_sync() {
        let settings = LyricsSettings::default();
        assert!(settings.sidecar_sync_enabled);
        assert!(settings.auto_fetch_in_lightbox);
    }

    #[test]
    fn default_cd_settings_use_lossless_flac_import_profile() {
        let settings = CdSettings::default();
        assert_eq!(
            settings.import_profile_id,
            crate::encoding_profiles::DEFAULT_CD_IMPORT_PROFILE_ID
        );
    }

    #[test]
    fn resolved_cd_import_profile_id_falls_back_for_unknown_values() {
        assert_eq!(
            resolved_cd_import_profile_id("lossless-flac"),
            "lossless-flac"
        );
        assert_eq!(
            resolved_cd_import_profile_id("not-a-profile"),
            crate::encoding_profiles::DEFAULT_CD_IMPORT_PROFILE_ID
        );
    }

    #[test]
    fn normalize_playback_settings_clamps_crossfade_seconds() {
        let settings = normalize_playback_settings(PlaybackSettings {
            crossfade_enabled: true,
            crossfade_seconds: 99,
            crossfade_on_skip: false,
            crossfade_visual_enabled: true,
        });
        assert_eq!(settings.crossfade_seconds, MAX_CROSSFADE_SECONDS);

        let settings = normalize_playback_settings(PlaybackSettings {
            crossfade_enabled: true,
            crossfade_seconds: 0,
            crossfade_on_skip: false,
            crossfade_visual_enabled: true,
        });
        assert_eq!(settings.crossfade_seconds, MIN_CROSSFADE_SECONDS);
    }
}
