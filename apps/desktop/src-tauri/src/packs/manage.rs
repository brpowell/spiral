//! Item-level list / uninstall for the Appearance management UI.

use super::paths::{
    builtin_packs_root, ensure_packs_ready, installed_packs_root, workshop_packs_root,
};
use super::scan::scan_all_items;
use super::{item_manifest_filename, read_item_manifest, PackZone};
use serde::Serialize;
use spk_format::{list_item_dirs, resolve_preview_file};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSummary {
    pub r#type: String,
    pub id: String,
    pub author_id: String,
    pub effective_id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    /// Freeform credit from the manifest's `author` field (may be empty).
    pub author: String,
    /// Declared preview image path relative to `dir`, when the file exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub zone: PackZone,
    pub dir: String,
    pub hidden: bool,
    /// True when this directory wins in the scan registry for its effective id.
    pub active: bool,
}

fn peek_freeform_author(manifest_path: &Path) -> String {
    fs::read_to_string(manifest_path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|v| {
            v.get("author")
                .and_then(|a| a.as_str())
                .map(|a| a.trim().to_string())
        })
        .unwrap_or_default()
}

fn summarize_item_dir(
    dir: &Path,
    zone: PackZone,
    hidden: &HashSet<String>,
    active_dirs: &HashSet<PathBuf>,
) -> Option<ItemSummary> {
    let item = read_item_manifest(dir).ok()?;
    let manifest_path = dir.join(item_manifest_filename(&item.item_type)?);
    let preview = resolve_preview_file(dir, item.preview.as_deref()).and_then(|abs| {
        abs.strip_prefix(dir)
            .ok()
            .map(|rel| rel.to_string_lossy().replace('\\', "/"))
    });
    let effective_id = item.effective_id();

    Some(ItemSummary {
        hidden: hidden.contains(&effective_id),
        active: active_dirs.contains(dir),
        author: peek_freeform_author(&manifest_path),
        r#type: item.item_type,
        id: item.id,
        author_id: item.author_id,
        effective_id,
        version: item.version,
        name: item.name,
        description: item.description,
        preview,
        zone,
        dir: dir.to_string_lossy().into_owned(),
    })
}

fn collect_zone_items(
    root: &Path,
    zone: PackZone,
    hidden: &HashSet<String>,
    active_dirs: &HashSet<PathBuf>,
) -> Vec<ItemSummary> {
    if !root.is_dir() {
        return vec![];
    }
    list_item_dirs(root)
        .into_iter()
        .filter_map(|(_, dir)| summarize_item_dir(&dir, zone, hidden, active_dirs))
        .collect()
}

/// List every item directory across builtin / workshop / installed / linked.
pub fn list_items(app: &AppHandle, hidden: &HashSet<String>) -> Result<Vec<ItemSummary>, String> {
    ensure_packs_ready(app)?;

    let scan = scan_all_items(app);
    let active_dirs: HashSet<PathBuf> = scan
        .contributions
        .iter()
        .map(|c| c.contribution_dir.clone())
        .collect();

    let mut items = Vec::new();
    items.extend(collect_zone_items(
        &builtin_packs_root(app),
        PackZone::Builtin,
        hidden,
        &active_dirs,
    ));
    if let Ok(workshop) = workshop_packs_root(app) {
        items.extend(collect_zone_items(
            &workshop,
            PackZone::Workshop,
            hidden,
            &active_dirs,
        ));
    }
    if let Ok(installed) = installed_packs_root(app) {
        items.extend(collect_zone_items(
            &installed,
            PackZone::Installed,
            hidden,
            &active_dirs,
        ));
    }

    for raw in crate::settings::read_settings(app).linked_item_paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(summary) =
            summarize_item_dir(Path::new(trimmed), PackZone::Linked, hidden, &active_dirs)
        {
            items.push(summary);
        }
    }

    items.sort_by(|a, b| {
        a.r#type
            .cmp(&b.r#type)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.effective_id.cmp(&b.effective_id))
            .then_with(|| a.zone.as_str().cmp(b.zone.as_str()))
    });

    Ok(items)
}

/// Find the installed directory for `effective_id` under `installed_root`.
fn find_installed_item_dir(installed_root: &Path, effective_id: &str) -> Option<PathBuf> {
    list_item_dirs(installed_root)
        .into_iter()
        .map(|(_, dir)| dir)
        .find(|dir| {
            read_item_manifest(dir)
                .map(|item| item.effective_id() == effective_id)
                .unwrap_or(false)
        })
}

/// Delete an installed item. Builtin, workshop and linked items are rejected.
pub fn uninstall_installed_item(app: &AppHandle, effective_id: &str) -> Result<(), String> {
    ensure_packs_ready(app)?;
    uninstall_from(&installed_packs_root(app)?, effective_id)
}

fn uninstall_from(installed_root: &Path, effective_id: &str) -> Result<(), String> {
    let effective_id = effective_id.trim();
    if effective_id.is_empty() {
        return Err("item id is required".into());
    }
    let dir = find_installed_item_dir(installed_root, effective_id)
        .ok_or_else(|| format!("installed item \"{effective_id}\" not found"))?;
    fs::remove_dir_all(&dir).map_err(|e| format!("failed to delete \"{effective_id}\": {e}"))
}

#[cfg(test)]
mod tests {
    use super::super::install::test_support::*;
    use super::*;

    #[test]
    fn summarize_reads_item_fields() {
        let root = temp_root("manage-summary");
        let dir = root.join("themes/bryan.demo");
        write_theme_item(&dir, "bryan", "demo", "1.2.3");
        let hidden = HashSet::from(["bryan.theme.demo".to_string()]);
        let active = HashSet::from([dir.clone()]);

        let s = summarize_item_dir(&dir, PackZone::Installed, &hidden, &active).unwrap();
        assert_eq!(s.r#type, "theme");
        assert_eq!(s.effective_id, "bryan.theme.demo");
        assert_eq!(s.version, "1.2.3");
        assert_eq!(s.name, "Theme demo");
        assert_eq!(s.author, "Test");
        assert!(s.hidden);
        assert!(s.active);
        assert!(s.preview.is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn summarize_resolves_declared_preview_only() {
        let root = temp_root("manage-preview");
        let dir = root.join("themes/bryan.demo");
        write_theme_item(&dir, "bryan", "demo", "1.0.0");
        fs::write(dir.join("preview.png"), b"x").unwrap();
        let none = HashSet::new();

        // Present on disk but undeclared: ignored.
        let s = summarize_item_dir(&dir, PackZone::Workshop, &none, &none_paths()).unwrap();
        assert!(s.preview.is_none());

        let text = fs::read_to_string(dir.join("theme.json")).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&text).unwrap();
        value["preview"] = "preview.png".into();
        fs::write(dir.join("theme.json"), value.to_string()).unwrap();
        let s = summarize_item_dir(&dir, PackZone::Workshop, &none, &none_paths()).unwrap();
        assert_eq!(s.preview.as_deref(), Some("preview.png"));
        assert!(!s.active);
        let _ = fs::remove_dir_all(&root);
    }

    fn none_paths() -> HashSet<PathBuf> {
        HashSet::new()
    }

    #[test]
    fn uninstall_removes_only_the_matching_item() {
        let root = temp_root("manage-uninstall");
        write_theme_item(&root.join("themes/bryan.keep"), "bryan", "keep", "1.0.0");
        write_theme_item(&root.join("themes/bryan.drop"), "bryan", "drop", "1.0.0");

        uninstall_from(&root, "bryan.theme.drop").unwrap();
        assert!(!root.join("themes/bryan.drop").exists());
        assert!(root.join("themes/bryan.keep").is_dir());
        assert!(uninstall_from(&root, "bryan.theme.drop").is_err());
        assert!(uninstall_from(&root, " ").is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
