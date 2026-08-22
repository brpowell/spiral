use crate::commands::packs::{forget_contribution_references, remap_contribution_id_references};
use crate::packs::install::pack_has_contributions;
use crate::packs::{
    self, effective_contribution_id, ensure_workshop_root, is_kebab_slug, pack_id_prefix,
    scan_contributions_of_type, slugify_id, PackManifest, PackZone, PACK_MANIFEST_FILENAME,
    PACK_MANIFEST_VERSION,
};
use crate::settings;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub tokens: HashMap<String, String>,
    pub author_id: String,
    pub pack_id: String,
    pub pack_name: String,
    pub pack_version: String,
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

/// Default tokens for a brand-new workshop theme (Obsidian baseline).
fn default_workshop_tokens() -> HashMap<String, String> {
    HashMap::from([
        ("color-bg".into(), "#0e0e10".into()),
        ("color-surface".into(), "#1a1a1e".into()),
        ("color-surface-raised".into(), "#242428".into()),
        ("color-text-primary".into(), "#f0f0f0".into()),
        ("color-text-secondary".into(), "#888899".into()),
        ("color-text-muted".into(), "#6a6a7a".into()),
        ("color-accent".into(), "#7b8cde".into()),
        ("color-accent-muted".into(), "#3a4170".into()),
        ("color-accent-text".into(), "#ffffff".into()),
        ("color-border".into(), "#2a2a32".into()),
        ("color-danger".into(), "#e06c75".into()),
        ("color-danger-bg".into(), "#2a1518".into()),
        ("color-interactive".into(), "#7b8cde".into()),
        ("color-interactive-selected-text".into(), "#7b8cde".into()),
        ("color-alert-info".into(), "#9aa8e8".into()),
        ("color-alert-info-bg".into(), "#1a1f35".into()),
        ("color-alert-info-border".into(), "#3a4570".into()),
        ("color-alert-success".into(), "#7fd492".into()),
        ("color-alert-success-bg".into(), "#152418".into()),
        ("color-alert-success-border".into(), "#2a5c38".into()),
        ("color-alert-warning".into(), "#e8c57b".into()),
        ("color-alert-warning-bg".into(), "#2a2418".into()),
        ("color-alert-warning-border".into(), "#5c4a2a".into()),
        ("color-alert-error".into(), "#e06c75".into()),
        ("color-alert-error-bg".into(), "#2a1518".into()),
        ("color-alert-error-border".into(), "#5c2a30".into()),
        ("radius-card".into(), "10px".into()),
        ("radius-button".into(), "6px".into()),
        ("radius-input".into(), "6px".into()),
        (
            "font-ui".into(),
            "'Inter', system-ui, -apple-system, sans-serif".into(),
        ),
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

fn local_id_from_effective(
    effective_id: &str,
    author_id: &str,
    pack_id: &str,
    contrib_type: &str,
) -> Option<String> {
    let prefix = format!("{author_id}.{pack_id}.{contrib_type}.");
    effective_id
        .strip_prefix(&prefix)
        .filter(|s| !s.is_empty() && !s.contains('.'))
        .map(str::to_string)
}

fn normalize_theme_file(file: ThemeFile, contrib: &packs::ScannedContribution) -> Theme {
    // Declared id in JSON is the local contribution id; effective id comes from the scan.
    let _ = file.id;
    Theme {
        id: contrib.effective_id.clone(),
        name: file.name,
        author: file.author,
        description: file.description,
        tokens: file.tokens,
        author_id: contrib.author_id.clone(),
        pack_id: contrib.pack_id.clone(),
        pack_name: contrib.pack_name.clone(),
        pack_version: contrib.pack_version.clone(),
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
        eprintln!("pack scan: {}", w.message);
    }

    let hidden: HashSet<String> = settings::read_settings(app)
        .hidden_contribution_ids
        .into_iter()
        .collect();

    let mut builtin = Vec::new();
    let mut user = Vec::new();
    for contrib in &scan.contributions {
        if hidden.contains(&contrib.effective_id) {
            continue;
        }
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

fn find_theme_contribution(
    app: &AppHandle,
    theme_id: &str,
) -> Result<packs::ScannedContribution, String> {
    packs::ensure_packs_ready(app)?;
    let scan = scan_contributions_of_type(app, "theme");
    scan.contributions
        .into_iter()
        .find(|c| c.effective_id == theme_id)
        .ok_or_else(|| format!("theme \"{theme_id}\" not found"))
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

fn write_theme_contribution(path: &Path, theme: &Theme, local_id: &str) -> Result<(), String> {
    let file = serde_json::json!({
        "id": local_id,
        "name": theme.name,
        "author": theme.author,
        "description": theme.description,
        "tokens": theme.tokens,
    });
    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("failed to serialize theme: {e}"))?;
    fs::write(path, format!("{json}\n")).map_err(|e| format!("failed to write theme file: {e}"))
}

fn write_pack_manifest(pack_dir: &Path, pack: &PackManifest) -> Result<(), String> {
    let pack_json = serde_json::to_string_pretty(pack)
        .map_err(|e| format!("failed to serialize pack.json: {e}"))?;
    fs::write(
        pack_dir.join(PACK_MANIFEST_FILENAME),
        format!("{pack_json}\n"),
    )
    .map_err(|e| format!("failed to write pack.json: {e}"))
}

fn unique_workshop_pack_id(workshop: &Path, base: &str) -> String {
    let mut candidate = base.to_string();
    let mut n = 2;
    while workshop.join(&candidate).exists() {
        candidate = format!("{base}-{n}");
        n += 1;
    }
    candidate
}

fn unique_theme_local_id(pack_dir: &Path, base: &str) -> String {
    let themes = pack_dir.join("themes");
    let mut candidate = base.to_string();
    let mut n = 2;
    while themes.join(&candidate).exists() {
        candidate = format!("{base}-{n}");
        n += 1;
    }
    candidate
}

fn resolve_default_author_id(app: &AppHandle) -> String {
    let stored = settings::read_settings(app).default_author_id;
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        settings::slugify_os_username()
    } else {
        trimmed.to_string()
    }
}

fn scaffold_workshop_theme_pack(
    app: &AppHandle,
    pack_id: &str,
    author_id: &str,
    local_id: &str,
    theme: &Theme,
) -> Result<PathBuf, String> {
    let workshop = ensure_workshop_root(app)?;
    let pack_dir = workshop.join(pack_id);
    if pack_dir.exists() {
        return Err(format!("workshop pack \"{pack_id}\" already exists"));
    }

    let theme_dir = pack_dir.join("themes").join(local_id);
    fs::create_dir_all(&theme_dir)
        .map_err(|e| format!("failed to create workshop theme dir: {e}"))?;

    write_theme_contribution(&theme_dir.join("theme.json"), theme, local_id)?;

    let pack = PackManifest {
        manifest_version: PACK_MANIFEST_VERSION,
        pack_id: pack_id.to_string(),
        author_id: author_id.to_string(),
        version: "0.0.0".to_string(),
        name: theme.pack_name.clone(),
        description: theme.description.clone(),
        preview: None,
        min_app_version: None,
    };
    write_pack_manifest(&pack_dir, &pack)?;
    Ok(pack_dir)
}

fn find_authoring_pack(
    app: &AppHandle,
    pack_id: &str,
) -> Result<(PathBuf, PackZone, String), String> {
    let packs = packs::manage::list_packs(app, &HashSet::new())?;
    let pack = packs
        .iter()
        .find(|p| p.pack_id == pack_id && p.zone.is_mutable())
        .ok_or_else(|| format!("authoring pack \"{pack_id}\" not found"))?;
    Ok((
        PathBuf::from(&pack.pack_dir),
        pack.zone,
        pack.author_id.clone(),
    ))
}

fn add_theme_to_existing_authoring_pack(
    app: &AppHandle,
    pack_id: &str,
    display_name: &str,
) -> Result<Theme, String> {
    let (pack_dir, zone, author_id) = find_authoring_pack(app, pack_id)?;
    let pack_json_path = pack_dir.join(PACK_MANIFEST_FILENAME);
    let contents = fs::read_to_string(&pack_json_path)
        .map_err(|e| format!("failed to read pack.json: {e}"))?;
    let pack = packs::parse_pack_manifest_json(&contents).map_err(|e| e.to_string())?;

    let local_id = unique_theme_local_id(&pack_dir, &slugify_theme_id(display_name));
    let theme_dir = pack_dir.join("themes").join(&local_id);
    fs::create_dir_all(&theme_dir).map_err(|e| format!("failed to create theme dir: {e}"))?;

    let effective_id = effective_contribution_id(&author_id, pack_id, "theme", &local_id);
    let theme = Theme {
        id: effective_id,
        name: display_name.to_string(),
        author: String::new(),
        description: String::new(),
        tokens: default_workshop_tokens(),
        author_id: author_id.clone(),
        pack_id: pack_id.to_string(),
        pack_name: pack.name.clone(),
        pack_version: pack.version.clone(),
        zone,
        mutable: true,
    };

    write_theme_contribution(&theme_dir.join("theme.json"), &theme, &local_id)?;
    Ok(theme)
}

/// Authoring write target: workshop drafts or linked external packs.
fn require_mutable_theme_contribution(
    app: &AppHandle,
    theme_id: &str,
) -> Result<packs::ScannedContribution, String> {
    let contrib = find_theme_contribution(app, theme_id)?;
    if !contrib.mutable {
        return Err(format!(
            "theme \"{theme_id}\" is not mutable and cannot be modified"
        ));
    }
    Ok(contrib)
}

fn remove_dir_all_with_context(path: &Path, label: &str) -> Result<(), String> {
    fs::remove_dir_all(path).map_err(|e| format!("failed to delete {label}: {e}"))
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

/// Scaffold a theme draft — either a new workshop pack, or a contribution inside
/// an existing workshop or linked pack. No author/version prompts (those happen at export).
#[tauri::command]
pub fn create_workshop_theme(
    app: AppHandle,
    name: Option<String>,
    pack_id: Option<String>,
    pack_name: Option<String>,
) -> Result<Theme, String> {
    packs::ensure_packs_ready(&app)?;

    let display_name = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Untitled Theme".to_string());

    if let Some(existing) = pack_id
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
    {
        return add_theme_to_existing_authoring_pack(&app, &existing, &display_name);
    }

    let pack_display_name = pack_name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| display_name.clone());

    let workshop = ensure_workshop_root(&app)?;
    let base_id = slugify_theme_id(&pack_display_name);
    let new_pack_id = unique_workshop_pack_id(&workshop, &base_id);
    let author_id = resolve_default_author_id(&app);
    let local_id = unique_theme_local_id(
        &workshop.join(&new_pack_id),
        &slugify_theme_id(&display_name),
    );
    let effective_id = effective_contribution_id(&author_id, &new_pack_id, "theme", &local_id);

    let theme = Theme {
        id: effective_id,
        name: display_name,
        author: String::new(),
        description: String::new(),
        tokens: default_workshop_tokens(),
        author_id: author_id.clone(),
        pack_id: new_pack_id.clone(),
        pack_name: pack_display_name,
        pack_version: "0.0.0".into(),
        zone: PackZone::Workshop,
        mutable: true,
    };

    scaffold_workshop_theme_pack(&app, &new_pack_id, &author_id, &local_id, &theme)?;
    Ok(theme)
}

/// Lenient save of a mutable theme draft (workshop or linked; incomplete tokens allowed).
///
/// `theme.id` is the current effective id used for lookup. To rename the contribution id,
/// set `theme.id` to the new effective id (`authorId.packId.theme.newLocalId`) while keeping
/// `authorId`/`packId` unchanged — when the old contribution is the only match in that pack
/// under a different local id, the folder is renamed and settings are remapped.
#[tauri::command]
pub fn save_workshop_theme(app: AppHandle, theme: Theme) -> Result<Theme, String> {
    packs::ensure_packs_ready(&app)?;

    let author_id = theme.author_id.trim().to_string();
    let pack_id = theme.pack_id.clone();

    if pack_id.trim().is_empty() || author_id.is_empty() {
        return Err("theme authorId and packId are required".into());
    }

    let mut theme = theme;
    theme.author_id = author_id.clone();

    let contrib_by_id = find_theme_contribution(&app, &theme.id).ok();
    let desired_local = local_id_from_effective(&theme.id, &author_id, &pack_id, "theme")
        .or_else(|| contrib_by_id.as_ref().map(|c| c.local_id.clone()))
        .ok_or_else(|| {
            format!(
                "theme id \"{}\" must be authorId.packId.theme.contributionId for pack \"{author_id}.{pack_id}\"",
                theme.id
            )
        })?;
    if !is_kebab_slug(&desired_local) {
        return Err(format!(
            "contribution id must be a kebab-case slug, got: {desired_local}"
        ));
    }

    let scan = scan_contributions_of_type(&app, "theme");
    let mut candidates: Vec<_> = scan
        .contributions
        .into_iter()
        .filter(|c| c.mutable && c.pack_id == pack_id && c.author_id == author_id)
        .collect();

    let contrib = if let Some(c) = contrib_by_id.filter(|c| c.mutable) {
        c
    } else if let Some(idx) = candidates.iter().position(|c| c.effective_id == theme.id) {
        candidates.swap_remove(idx)
    } else if candidates.len() == 1 {
        // Rename: only one theme in the pack — treat theme.id as the new effective id.
        candidates.swap_remove(0)
    } else if let Some(idx) = candidates.iter().position(|c| c.local_id == desired_local) {
        candidates.swap_remove(idx)
    } else {
        return Err(format!(
            "mutable theme \"{}\" not found in pack \"{author_id}.{pack_id}\"",
            theme.id
        ));
    };

    if !contrib.mutable {
        return Err(format!(
            "theme \"{}\" is not mutable and cannot be modified",
            contrib.effective_id
        ));
    }

    let old_effective = contrib.effective_id.clone();
    let old_local = contrib.local_id.clone();
    let new_effective = effective_contribution_id(&author_id, &pack_id, "theme", &desired_local);

    let mut contrib = contrib;
    if desired_local != old_local {
        let new_dir = contrib.pack_dir.join("themes").join(&desired_local);
        if new_dir.exists() {
            return Err(format!(
                "theme contribution \"{desired_local}\" already exists in pack \"{pack_id}\""
            ));
        }
        fs::rename(&contrib.contribution_dir, &new_dir).map_err(|e| {
            format!("failed to rename theme \"{old_local}\" → \"{desired_local}\": {e}")
        })?;
        contrib.contribution_dir = new_dir;
        contrib.manifest_path = contrib.contribution_dir.join("theme.json");
        contrib.local_id = desired_local.clone();
        contrib.effective_id = new_effective.clone();
        remap_contribution_id_references(&app, &old_effective, &new_effective)?;
    }

    write_theme_contribution(&contrib.manifest_path, &theme, &desired_local)?;

    let mut saved = theme;
    saved.id = new_effective;
    saved.author_id = author_id;
    saved.zone = contrib.zone;
    saved.mutable = true;
    Ok(saved)
}

/// Delete a single mutable theme contribution (workshop or linked). Empty
/// workshop packs are removed from disk; linked pack roots are left in place.
#[tauri::command]
pub fn delete_workshop_theme(app: AppHandle, theme_id: String) -> Result<(), String> {
    let theme_id = theme_id.trim();
    if theme_id.is_empty() {
        return Err("themeId is required".into());
    }
    let contrib = require_mutable_theme_contribution(&app, theme_id)?;

    let pack_dir = contrib.pack_dir.clone();
    let pack_id = contrib.pack_id.clone();
    let author_id = contrib.author_id.clone();
    let zone = contrib.zone;

    remove_dir_all_with_context(&contrib.contribution_dir, &format!("theme \"{theme_id}\""))?;

    let mut app_settings = settings::read_settings(&app);
    let was_active = app_settings.active_theme == theme_id;

    if !pack_has_contributions(&pack_dir) && zone == PackZone::Workshop {
        remove_dir_all_with_context(&pack_dir, &format!("workshop pack \"{pack_id}\""))?;
        // Clear any leftover pack-prefixed settings.
        let prefix = pack_id_prefix(&author_id, &pack_id);
        if app_settings.active_theme.starts_with(&prefix) {
            app_settings.active_theme = settings::DEFAULT_THEME_ID.to_string();
        }
        app_settings
            .hidden_contribution_ids
            .retain(|id| !id.starts_with(&prefix));
        let _ = settings::write_settings(&app, &app_settings);
    } else {
        forget_contribution_references(&app, theme_id)?;
        if was_active {
            let (builtin, user) = list_themes_from_scan(&app)?;
            let themes: Vec<_> = builtin.into_iter().chain(user).collect();
            let resolved = resolve_active_theme_id(&themes, "");
            app_settings.active_theme = resolved;
            let _ = settings::write_settings(&app, &app_settings);
        }
    }

    Ok(())
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
        assert_eq!(themes.len(), 5);
        let ids: Vec<&str> = themes.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "spiral.core.theme.abyss",
                "spiral.core.theme.grove",
                "spiral.core.theme.noir",
                "spiral.core.theme.obsidian",
                "spiral.core.theme.parchment"
            ]
        );
        for theme in &themes {
            assert_eq!(theme.zone, PackZone::Builtin);
            assert!(!theme.mutable);
            assert_eq!(theme.pack_id, "core");
            assert_eq!(theme.author_id, "spiral");
        }
    }

    #[test]
    fn resolve_known_id_or_default() {
        let themes = load_builtin_themes_from_disk();
        assert_eq!(
            resolve_active_theme_id(&themes, "spiral.core.theme.obsidian"),
            "spiral.core.theme.obsidian"
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
    fn slugify_theme_id_from_name_and_filename() {
        assert_eq!(slugify_theme_id("My Cool Theme"), "my-cool-theme");
        assert_eq!(slugify_theme_id("obsidian.theme"), "obsidian-theme");
        assert_eq!(slugify_theme_id("  "), "theme");
    }

    #[test]
    fn unique_workshop_pack_id_avoids_collisions() {
        let dir = tempfile_workshop();
        fs::create_dir_all(dir.join("untitled-theme")).unwrap();
        assert_eq!(
            unique_workshop_pack_id(&dir, "untitled-theme"),
            "untitled-theme-2"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unique_theme_local_id_avoids_collisions() {
        let dir = tempfile_workshop();
        fs::create_dir_all(dir.join("themes").join("midnight")).unwrap();
        assert_eq!(unique_theme_local_id(&dir, "midnight"), "midnight-2");
        let _ = fs::remove_dir_all(&dir);
    }

    fn tempfile_workshop() -> PathBuf {
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
