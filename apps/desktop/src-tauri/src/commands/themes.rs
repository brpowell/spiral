use crate::commands::items::{find_mutable_item, scaffold_workshop_item_dir};
use crate::packs::{self, scan_contributions_of_type, slugify_id, PackZone};
use crate::settings;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub tokens: HashMap<String, String>,
    pub publisher_id: String,
    pub version: String,
    pub zone: PackZone,
    pub mutable: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct ThemeFile {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    tokens: HashMap<String, String>,
}

/// Obsidian baseline, used when the active theme cannot be read.
fn default_workshop_tokens() -> HashMap<String, String> {
    HashMap::from([
        ("color-bg".into(), "#0e0e10".into()),
        ("color-text-primary".into(), "#f0f0f0".into()),
        ("color-accent".into(), "#7b8cde".into()),
        ("color-danger".into(), "#e06c75".into()),
        ("color-alert-info".into(), "#9aa8e8".into()),
        ("color-alert-success".into(), "#7fd492".into()),
        ("color-alert-warning".into(), "#e8c57b".into()),
        ("font-ui".into(), "inter".into()),
    ])
}

fn slugify_theme_id(input: &str) -> String {
    let slug = slugify_id(input);
    if slug == "untitled" {
        "theme".to_string()
    } else {
        slug
    }
}

fn normalize_theme_file(file: ThemeFile, contrib: &packs::ScannedContribution) -> Theme {
    // Declared id in JSON is the local item id; effective id comes from the scan.
    let _ = file.id;
    Theme {
        id: contrib.effective_id.clone(),
        name: file.name,
        author: file.author,
        description: file.description,
        tokens: file.tokens,
        publisher_id: contrib.publisher_id.clone(),
        version: contrib.version.clone(),
        zone: contrib.zone,
        mutable: contrib.mutable,
    }
}

fn load_theme_from_contribution(contrib: &packs::ScannedContribution) -> Result<Theme, String> {
    let contents = fs::read_to_string(&contrib.manifest_path).map_err(|e| {
        format!(
            "could not read theme {}: {e}",
            contrib.manifest_path.display()
        )
    })?;
    let file: ThemeFile = serde_json::from_str(&contents).map_err(|e| {
        format!(
            "{} is not valid theme JSON: {e}",
            contrib.manifest_path.display()
        )
    })?;
    Ok(normalize_theme_file(file, contrib))
}

fn list_themes_from_scan(app: &AppHandle) -> Result<(Vec<Theme>, Vec<Theme>), String> {
    packs::ensure_packs_ready(app)?;
    let scan = scan_contributions_of_type(app, "theme");
    for w in &scan.warnings {
        eprintln!("item scan: {}", w.message);
    }

    let mut builtin = Vec::new();
    let mut user = Vec::new();
    for contrib in &scan.contributions {
        match load_theme_from_contribution(contrib) {
            Ok(theme) => {
                if contrib.zone == PackZone::Builtin {
                    builtin.push(theme);
                } else {
                    user.push(theme);
                }
            }
            Err(e) => eprintln!("theme load skipped: {e}"),
        }
    }

    builtin.sort_by(|a, b| a.name.cmp(&b.name));
    user.sort_by(|a, b| a.name.cmp(&b.name));
    Ok((builtin, user))
}

fn find_theme_by_id<'a>(themes: &'a [Theme], id: &str) -> Option<&'a Theme> {
    themes.iter().find(|t| t.id == id)
}

/// Tokens for a new theme: a copy of the resolved active theme, or the Obsidian baseline.
fn tokens_cloned_from_active(themes: &[Theme], stored_active: &str) -> HashMap<String, String> {
    let resolved = resolve_active_theme_id(themes, stored_active);
    find_theme_by_id(themes, &resolved)
        .filter(|theme| !theme.tokens.is_empty())
        .map(|theme| theme.tokens.clone())
        .unwrap_or_else(default_workshop_tokens)
}

fn seed_tokens_for_new_theme(app: &AppHandle) -> HashMap<String, String> {
    let Ok((builtin, user)) = list_themes_from_scan(app) else {
        return default_workshop_tokens();
    };
    let themes: Vec<_> = builtin.into_iter().chain(user).collect();
    let stored = settings::read_settings(app).active_theme;
    tokens_cloned_from_active(&themes, &stored)
}

/// Resolve a stored active-theme id, or fall back to the default / first theme.
fn resolve_active_theme_id(themes: &[Theme], stored: &str) -> String {
    if find_theme_by_id(themes, stored).is_some() {
        return stored.to_string();
    }
    if find_theme_by_id(themes, settings::DEFAULT_THEME_ID).is_some() {
        return settings::DEFAULT_THEME_ID.to_string();
    }
    themes
        .first()
        .map(|t| t.id.clone())
        .unwrap_or_else(|| settings::DEFAULT_THEME_ID.to_string())
}

/// Write a theme's editable content into its manifest, preserving identity and
/// distribution fields (`id`, `publisherId`, `version`, `minAppVersion`, `preview`, …).
fn write_theme_contribution(path: &Path, theme: &Theme) -> Result<(), String> {
    let text =
        fs::read_to_string(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let mut value: serde_json::Value =
        serde_json::from_str(text.strip_prefix('\u{feff}').unwrap_or(&text))
            .map_err(|e| format!("{} is not valid theme JSON: {e}", path.display()))?;
    let obj = value
        .as_object_mut()
        .ok_or_else(|| format!("{} must be a JSON object", path.display()))?;
    obj.insert("name".into(), theme.name.clone().into());
    obj.insert("author".into(), theme.author.clone().into());
    obj.insert("description".into(), theme.description.clone().into());
    obj.insert(
        "tokens".into(),
        serde_json::to_value(&theme.tokens)
            .map_err(|e| format!("failed to serialize theme tokens: {e}"))?,
    );
    let json = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("failed to serialize theme: {e}"))?;
    fs::write(path, format!("{json}\n")).map_err(|e| format!("failed to write theme file: {e}"))
}

#[tauri::command]
pub fn get_builtin_themes(app: AppHandle) -> Result<Vec<Theme>, String> {
    let (builtin, _) = list_themes_from_scan(&app)?;
    Ok(builtin)
}

#[tauri::command]
pub fn load_user_themes(app: AppHandle) -> Result<Vec<Theme>, String> {
    let (_, user) = list_themes_from_scan(&app)?;
    Ok(user)
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
    let (builtin, user) = list_themes_from_scan(&app)?;
    let themes: Vec<_> = builtin.into_iter().chain(user).collect();
    let resolved = resolve_active_theme_id(&themes, &app_settings.active_theme);
    if resolved != app_settings.active_theme {
        app_settings.active_theme = resolved.clone();
        let _ = settings::write_settings(&app, &app_settings);
    }
    Ok(resolved)
}

/// Scaffold a theme draft in the workshop. Tokens are copied from the active theme.
/// No author/version prompts (those happen at export).
#[tauri::command]
pub fn create_workshop_theme(app: AppHandle, name: Option<String>) -> Result<Theme, String> {
    packs::ensure_packs_ready(&app)?;

    let display_name = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Untitled Theme".to_string());

    let publisher_id = crate::commands::items::default_publisher_id(&app);
    let (dir, id) = scaffold_workshop_item_dir(
        &app,
        "theme",
        &publisher_id,
        &slugify_theme_id(&display_name),
    )?;

    let seed = serde_json::json!({
        "id": id,
        "publisherId": publisher_id,
        "version": "0.0.0",
        "name": display_name,
        "author": "",
        "description": "",
        "tokens": {},
    });
    let manifest = dir.join("theme.json");
    let json = serde_json::to_string_pretty(&seed)
        .map_err(|e| format!("failed to serialize theme: {e}"))?;
    fs::write(&manifest, format!("{json}\n"))
        .map_err(|e| format!("failed to write theme file: {e}"))?;

    let theme = Theme {
        id: packs::effective_item_id(&publisher_id, "theme", &id),
        name: display_name,
        author: String::new(),
        description: String::new(),
        tokens: seed_tokens_for_new_theme(&app),
        publisher_id,
        version: "0.0.0".into(),
        zone: PackZone::Workshop,
        mutable: true,
    };
    write_theme_contribution(&manifest, &theme)?;
    Ok(theme)
}

/// Lenient save of a mutable theme draft (workshop or linked; incomplete tokens allowed).
///
/// `theme.id` is the effective id used for lookup. Only name, author, description and
/// tokens are written; identity changes go through `update_item_metadata`.
#[tauri::command]
pub fn save_workshop_theme(app: AppHandle, theme: Theme) -> Result<Theme, String> {
    packs::ensure_packs_ready(&app)?;

    let contrib = find_mutable_item(&app, &theme.id)?;
    if contrib.r#type != "theme" {
        return Err(format!("\"{}\" is not a theme", theme.id));
    }
    write_theme_contribution(&contrib.manifest_path, &theme)?;

    let mut saved = theme;
    saved.publisher_id = contrib.publisher_id;
    saved.version = contrib.version;
    saved.zone = contrib.zone;
    saved.mutable = true;
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packs::scan::scan_zone_root;
    use std::path::PathBuf;

    fn load_builtin_themes_from_disk() -> Vec<Theme> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("packs/builtin");
        let mut warnings = Vec::new();
        let contribs = scan_zone_root(&root, PackZone::Builtin, &mut warnings);
        contribs
            .iter()
            .filter(|c| c.r#type == "theme")
            .map(|c| load_theme_from_contribution(c).expect("builtin theme loads"))
            .collect()
    }

    #[test]
    fn builtin_themes_parse_with_namespaced_ids() {
        let mut themes = load_builtin_themes_from_disk();
        themes.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(themes.len(), 8);
        let ids: Vec<&str> = themes.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "spiral.theme.abyss",
                "spiral.theme.grove",
                "spiral.theme.noir",
                "spiral.theme.obsidian",
                "spiral.theme.parchment",
                "spiral.theme.sprig",
                "spiral.theme.sprig-dark",
                "spiral.theme.strawberry",
            ]
        );
        for theme in &themes {
            assert_eq!(theme.zone, PackZone::Builtin);
            // Built-ins are editable in debug builds only (see `PackZone::is_editable`).
            assert_eq!(theme.mutable, cfg!(debug_assertions));
            assert_eq!(theme.version, "1.0.0");
            assert_eq!(theme.publisher_id, "spiral");
        }
    }

    #[test]
    fn resolve_known_id_or_default() {
        let themes = load_builtin_themes_from_disk();
        assert_eq!(
            resolve_active_theme_id(&themes, "spiral.theme.obsidian"),
            "spiral.theme.obsidian"
        );
        assert_eq!(
            resolve_active_theme_id(&themes, "Obsidian"),
            settings::DEFAULT_THEME_ID
        );
        assert_eq!(
            resolve_active_theme_id(&themes, "obsidian"),
            settings::DEFAULT_THEME_ID
        );
    }

    #[test]
    fn resolve_unknown_falls_back_to_default() {
        let themes = load_builtin_themes_from_disk();
        assert_eq!(
            resolve_active_theme_id(&themes, "not-a-theme"),
            settings::DEFAULT_THEME_ID
        );
    }

    #[test]
    fn new_theme_clones_active_theme_tokens() {
        let themes = load_builtin_themes_from_disk();
        let noir = find_theme_by_id(&themes, "spiral.theme.noir").unwrap();
        let cloned = tokens_cloned_from_active(&themes, "spiral.theme.noir");
        assert_eq!(cloned, noir.tokens);
        assert_ne!(
            cloned.get("color-accent").map(String::as_str),
            Some("#7b8cde")
        );
    }

    #[test]
    fn new_theme_clones_resolved_active_theme_when_stored_id_is_stale() {
        let themes = load_builtin_themes_from_disk();
        let obsidian = find_theme_by_id(&themes, settings::DEFAULT_THEME_ID).unwrap();
        let cloned = tokens_cloned_from_active(&themes, "not-a-theme");
        assert_eq!(cloned, obsidian.tokens);
    }

    #[test]
    fn new_theme_falls_back_to_obsidian_tokens_when_none_resolve() {
        let cloned = tokens_cloned_from_active(&[], "missing");
        assert_eq!(cloned.get("color-bg").map(String::as_str), Some("#0e0e10"));
        assert_eq!(
            cloned.get("color-accent").map(String::as_str),
            Some("#7b8cde")
        );
    }

    #[test]
    fn slugify_theme_id_from_name_and_filename() {
        assert_eq!(slugify_theme_id("My Cool Theme"), "my-cool-theme");
        assert_eq!(slugify_theme_id("obsidian.theme"), "obsidian-theme");
        assert_eq!(slugify_theme_id("  "), "theme");
    }

    #[test]
    fn a_new_theme_draft_can_be_validated_and_exported() {
        use crate::packs::export::{export_item_dir_to_spk, ExportItemMetadata};
        use crate::packs::install::validate_item_for_install;

        // Same steps as `create_workshop_theme`: seed manifest, then fill in tokens.
        let dir = tempfile_workshop();
        let path = dir.join("theme.json");
        fs::write(
            &path,
            r#"{"id":"draft","publisherId":"bryan","version":"0.0.0","name":"Draft","author":"","description":"","tokens":{}}"#,
        )
        .unwrap();
        let theme = Theme {
            id: "bryan.theme.draft".into(),
            name: "Draft".into(),
            author: String::new(),
            description: String::new(),
            tokens: default_workshop_tokens(),
            publisher_id: "bryan".into(),
            version: "0.0.0".into(),
            zone: PackZone::Workshop,
            mutable: true,
        };
        write_theme_contribution(&path, &theme).unwrap();

        validate_item_for_install(&dir).expect("a fresh draft must be installable");
        let spk = dir.join("draft.spk");
        export_item_dir_to_spk(
            &dir,
            &ExportItemMetadata {
                name: "Draft".into(),
                version: "1.0.0".into(),
                description: String::new(),
            },
            &spk,
        )
        .expect("a fresh draft must be exportable");
        assert!(spk.is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_theme_preserves_identity_fields() {
        let dir = tempfile_workshop();
        let path = dir.join("theme.json");
        fs::write(
            &path,
            r#"{"id":"midnight","publisherId":"bryan","version":"0.0.0","minAppVersion":"0.2.0","name":"Old","author":"","description":"","tokens":{}}"#,
        )
        .unwrap();
        let theme = Theme {
            id: "bryan.theme.midnight".into(),
            name: "New".into(),
            author: "Bryan".into(),
            description: "desc".into(),
            tokens: HashMap::from([("color-bg".to_string(), "#000".to_string())]),
            publisher_id: "bryan".into(),
            version: "0.0.0".into(),
            zone: PackZone::Workshop,
            mutable: true,
        };
        write_theme_contribution(&path, &theme).unwrap();

        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["id"], "midnight");
        assert_eq!(value["publisherId"], "bryan");
        assert_eq!(value["minAppVersion"], "0.2.0");
        assert_eq!(value["name"], "New");
        assert_eq!(value["author"], "Bryan");
        assert_eq!(value["tokens"]["color-bg"], "#000");
        let _ = fs::remove_dir_all(&dir);
    }

    fn tempfile_workshop() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "spiral-workshop-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        dir
    }
}
