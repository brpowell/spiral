use crate::settings;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub tokens: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ThemeFile {
    #[serde(default)]
    id: Option<String>,
    name: String,
    author: String,
    description: String,
    tokens: HashMap<String, String>,
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

/// Slugify a display name or filename stem into a stable theme id.
fn slugify_theme_id(input: &str) -> String {
    let mut out = String::new();
    let mut pending_hyphen = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_hyphen && !out.is_empty() {
                out.push('-');
            }
            pending_hyphen = false;
            out.push(ch.to_ascii_lowercase());
        } else if !out.is_empty() {
            pending_hyphen = true;
        }
    }
    if out.is_empty() {
        "theme".to_string()
    } else {
        out
    }
}

fn theme_id_from_path(path: &Path) -> String {
    let stem = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("theme")
        .trim_end_matches(".theme.json")
        .trim_end_matches(".json");
    slugify_theme_id(stem)
}

fn normalize_theme(file: ThemeFile, fallback_id: String) -> Theme {
    let id = file
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or(fallback_id);
    Theme {
        id,
        name: file.name,
        author: file.author,
        description: file.description,
        tokens: file.tokens,
    }
}

fn parse_theme_file(path: &Path, contents: &str) -> Option<Theme> {
    match serde_json::from_str::<ThemeFile>(contents) {
        Ok(file) => Some(normalize_theme(file, theme_id_from_path(path))),
        Err(e) => {
            eprintln!("theme parse error for {}: {e}", path.display());
            None
        }
    }
}

fn parse_builtin_theme(json: &str) -> Result<Theme, String> {
    let file: ThemeFile =
        serde_json::from_str(json).map_err(|e| format!("failed to parse built-in theme: {e}"))?;
    let fallback = slugify_theme_id(&file.name);
    let theme = normalize_theme(file, fallback);
    if theme.id.is_empty() {
        return Err("built-in theme is missing id".to_string());
    }
    Ok(theme)
}

fn load_builtin_themes() -> Result<Vec<Theme>, String> {
    let mut themes = Vec::with_capacity(BUILTIN_THEMES.len());
    for json in BUILTIN_THEMES {
        themes.push(parse_builtin_theme(json)?);
    }
    Ok(themes)
}

fn find_theme_by_id<'a>(themes: &'a [Theme], id: &str) -> Option<&'a Theme> {
    themes.iter().find(|t| t.id == id)
}

fn find_theme_by_name<'a>(themes: &'a [Theme], name: &str) -> Option<&'a Theme> {
    themes.iter().find(|t| t.name == name)
}

/// Resolve a stored active-theme value to a stable id.
/// Legacy settings stored display names; rewrite those to ids.
fn resolve_active_theme_id(themes: &[Theme], stored: &str) -> String {
    if find_theme_by_id(themes, stored).is_some() {
        return stored.to_string();
    }
    if let Some(theme) = find_theme_by_name(themes, stored) {
        return theme.id.clone();
    }
    if find_theme_by_id(themes, settings::DEFAULT_THEME_ID).is_some() {
        return settings::DEFAULT_THEME_ID.to_string();
    }
    themes
        .first()
        .map(|t| t.id.clone())
        .unwrap_or_else(|| settings::DEFAULT_THEME_ID.to_string())
}

fn collect_known_theme_ids(app: &AppHandle) -> Result<Vec<String>, String> {
    let mut ids: Vec<String> = load_builtin_themes()?.into_iter().map(|t| t.id).collect();
    for theme in load_user_themes_from_disk(app)? {
        ids.push(theme.id);
    }
    Ok(ids)
}

fn load_user_themes_from_disk(app: &AppHandle) -> Result<Vec<Theme>, String> {
    let dir = themes_dir(app)?;
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

fn write_theme_file(path: &Path, theme: &Theme) -> Result<(), String> {
    let json = serde_json::to_string_pretty(theme)
        .map_err(|e| format!("failed to serialize theme: {e}"))?;
    fs::write(path, format!("{json}\n")).map_err(|e| format!("failed to write theme file: {e}"))
}

#[tauri::command]
pub fn get_builtin_themes() -> Result<Vec<Theme>, String> {
    load_builtin_themes()
}

#[tauri::command]
pub fn load_user_themes(app: AppHandle) -> Result<Vec<Theme>, String> {
    load_user_themes_from_disk(&app)
}

#[tauri::command]
pub fn save_active_theme_id(app: AppHandle, theme_id: String) -> Result<(), String> {
    let mut app_settings = settings::read_settings(&app);
    app_settings.active_theme = theme_id;
    settings::write_settings(&app, &app_settings)
}

#[tauri::command]
pub fn get_active_theme_id(app: AppHandle) -> Result<String, String> {
    let mut app_settings = settings::read_settings(&app);
    let themes = {
        let mut all = load_builtin_themes()?;
        all.extend(load_user_themes_from_disk(&app)?);
        all
    };
    let resolved = resolve_active_theme_id(&themes, &app_settings.active_theme);
    if resolved != app_settings.active_theme {
        app_settings.active_theme = resolved.clone();
        let _ = settings::write_settings(&app, &app_settings);
    }
    Ok(resolved)
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

    let contents =
        fs::read_to_string(&source).map_err(|e| format!("failed to read theme file: {e}"))?;
    let file: ThemeFile = serde_json::from_str(&contents)
        .map_err(|e| format!("imported theme file is not valid JSON: {e}"))?;
    let had_explicit_id = file
        .id
        .as_deref()
        .map(str::trim)
        .is_some_and(|s| !s.is_empty());
    let mut theme = normalize_theme(file, theme_id_from_path(&source));
    if !had_explicit_id {
        let from_name = slugify_theme_id(&theme.name);
        if from_name != "theme" {
            theme.id = from_name;
        }
    }

    let known_ids = collect_known_theme_ids(&app)?;
    if known_ids.iter().any(|id| id == &theme.id) {
        return Err(format!(
            "a theme with id \"{}\" already exists; choose a different id",
            theme.id
        ));
    }

    write_theme_file(&dest, &theme)?;
    Ok(Some(theme))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_themes_parse_with_stable_ids() {
        let themes = load_builtin_themes().expect("builtins parse");
        assert_eq!(themes.len(), 4);
        let ids: Vec<&str> = themes.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["obsidian", "parchment", "noir", "grove"]);
        assert_eq!(themes[0].name, "Obsidian");
        assert_eq!(themes[1].name, "Parchment");
        assert_eq!(themes[2].name, "Noir");
        assert_eq!(themes[3].name, "Grove");
    }

    #[test]
    fn resolve_migrates_legacy_display_name_to_id() {
        let themes = load_builtin_themes().unwrap();
        assert_eq!(resolve_active_theme_id(&themes, "Obsidian"), "obsidian");
        assert_eq!(resolve_active_theme_id(&themes, "Parchment"), "parchment");
        assert_eq!(resolve_active_theme_id(&themes, "Noir"), "noir");
        assert_eq!(resolve_active_theme_id(&themes, "Grove"), "grove");
    }

    #[test]
    fn resolve_keeps_existing_id() {
        let themes = load_builtin_themes().unwrap();
        assert_eq!(resolve_active_theme_id(&themes, "parchment"), "parchment");
    }

    #[test]
    fn resolve_unknown_falls_back_to_default() {
        let themes = load_builtin_themes().unwrap();
        assert_eq!(resolve_active_theme_id(&themes, "not-a-theme"), "obsidian");
    }

    #[test]
    fn slugify_theme_id_from_name_and_filename() {
        assert_eq!(slugify_theme_id("My Cool Theme"), "my-cool-theme");
        assert_eq!(slugify_theme_id("obsidian.theme"), "obsidian-theme");
        assert_eq!(slugify_theme_id("  "), "theme");
    }
}
