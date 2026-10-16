//! Item install / export / management Tauri commands.
//!
//! An item is one theme, skin, visualizer or sound (see [`crate::packs`]).

use crate::packs::export::{export_item_dir_to_spk, read_export_defaults, ExportItemMetadata};
use crate::packs::install::install_item_from_path;
use crate::packs::manage::uninstall_installed_item;
use crate::packs::scan::{peek_item_effective_id, scan_all_items, ScannedContribution};
use crate::packs::{
    self, builtin_packs_root, ensure_workshop_root, installed_packs_root, is_kebab_slug,
    item_dir_name, item_manifest_filename, item_type_folder, read_item_manifest, slugify_id,
    workshop_packs_root, ExportItemResult, InstallItemResult, ItemSummary, PackZone,
    PACK_ARCHIVE_EXTENSION, PACK_CHANGELOG_FILENAME, PACK_CHANGELOG_MAX_BYTES,
    PACK_README_FILENAME, PACK_README_MAX_BYTES,
};
use crate::settings;
use serde::Serialize;
use spk_format::{detect_item_type, parse_item_manifest_value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Resolve `dir` only if it is an item directory directly under
/// `<zone root>/<type folder>/`, or an absolute path listed in `linkedItemPaths`.
fn resolve_known_item_dir(app: &AppHandle, dir: &str) -> Result<PathBuf, String> {
    let trimmed = dir.trim();
    if trimmed.is_empty() {
        return Err("item directory is required".into());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_dir() {
        return Err("item directory not found".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("invalid item directory: {e}"))?;

    if detect_item_type(&canonical).is_err() {
        return Err("directory does not contain an item manifest".into());
    }

    let mut roots: Vec<PathBuf> = Vec::with_capacity(3);
    roots.push(builtin_packs_root(app));
    if let Ok(workshop) = workshop_packs_root(app) {
        roots.push(workshop);
    }
    if let Ok(installed) = installed_packs_root(app) {
        roots.push(installed);
    }

    for root in roots {
        let Ok(root_canon) = root.canonicalize() else {
            continue;
        };
        let type_root = canonical.parent();
        let is_under_type_folder = type_root.is_some_and(|t| {
            t.parent() == Some(root_canon.as_path())
                && t.file_name().and_then(|n| n.to_str()).is_some_and(|name| {
                    packs::CONTRIBUTION_TYPE_FOLDERS
                        .iter()
                        .any(|(folder, _, _)| *folder == name)
                })
        });
        if is_under_type_folder {
            return Ok(canonical);
        }
    }

    // Linked items: exact match against settings paths (canonicalized).
    for raw in settings::read_settings(app).linked_item_paths {
        let linked = PathBuf::from(raw.trim());
        let Ok(linked_canon) = linked.canonicalize() else {
            continue;
        };
        if linked_canon == canonical {
            return Ok(canonical);
        }
    }

    Err("item directory is outside known roots".into())
}

fn paths_equal_canonical(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => a == b,
    }
}

/// Configured default publisher id, seeded from the OS username when unset.
pub(crate) fn default_publisher_id(app: &AppHandle) -> String {
    let stored = settings::read_settings(app).default_publisher_id;
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        settings::slugify_os_username()
    } else {
        trimmed.to_string()
    }
}

/// First `base`, `base-2`, `base-3`… whose `<publisherId>.<id>` directory is free in `type_root`.
pub(crate) fn unique_item_id(type_root: &Path, publisher_id: &str, base: &str) -> String {
    let mut candidate = base.to_string();
    let mut n = 2;
    while type_root
        .join(item_dir_name(publisher_id, &candidate))
        .exists()
    {
        candidate = format!("{base}-{n}");
        n += 1;
    }
    candidate
}

/// Every effective id currently present as a workshop item.
fn workshop_item_ids(app: &AppHandle) -> HashSet<String> {
    let mut ids = HashSet::new();
    let Ok(workshop) = workshop_packs_root(app) else {
        return ids;
    };
    for (_, dir) in spk_format::list_item_dirs(&workshop) {
        if let Ok(id) = peek_item_effective_id(&dir) {
            ids.insert(id);
        }
    }
    ids
}

fn normalize_linked_path(path: &Path) -> Result<String, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("invalid item directory: {e}"))?;
    Ok(canonical.to_string_lossy().into_owned())
}

fn read_item_text_at(dir: &Path, filename: &str, max_bytes: u64) -> Result<Option<String>, String> {
    let path = dir.join(filename);
    if !path.is_file() {
        return Ok(None);
    }
    let meta = fs::metadata(&path).map_err(|e| format!("failed to read {filename}: {e}"))?;
    if meta.len() > max_bytes {
        return Err(format!("{filename} exceeds {max_bytes} byte limit"));
    }
    let contents =
        fs::read_to_string(&path).map_err(|e| format!("failed to read {filename}: {e}"))?;
    Ok(Some(contents))
}

fn authoring_item_writable(app: &AppHandle, dir: &Path) -> bool {
    let workshop_ok = workshop_packs_root(app)
        .ok()
        .and_then(|root| root.canonicalize().ok())
        .is_some_and(|w| dir.parent().and_then(Path::parent) == Some(w.as_path()));
    let linked_ok = settings::read_settings(app)
        .linked_item_paths
        .iter()
        .any(|raw| paths_equal_canonical(&PathBuf::from(raw.trim()), dir));
    workshop_ok || linked_ok
}

fn write_item_text_at(
    app: &AppHandle,
    dir: &str,
    filename: &str,
    max_bytes: u64,
    content: String,
    edit_denied_message: &str,
) -> Result<(), String> {
    packs::ensure_packs_ready(app)?;

    let dir = resolve_known_item_dir(app, dir)?;
    if !authoring_item_writable(app, &dir) {
        return Err(edit_denied_message.to_string());
    }

    let path = dir.join(filename);
    if content.trim().is_empty() {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("failed to remove {filename}: {e}"))?;
        }
        return Ok(());
    }

    if content.len() as u64 > max_bytes {
        return Err(format!("{filename} exceeds {max_bytes} byte limit"));
    }

    fs::write(&path, content).map_err(|e| format!("failed to write {filename}: {e}"))
}

fn hidden_item_set(app: &AppHandle) -> HashSet<String> {
    settings::read_settings(app)
        .hidden_contribution_ids
        .into_iter()
        .collect()
}

/// The authoring (workshop or linked) item with `effective_id`.
pub(crate) fn find_mutable_item(
    app: &AppHandle,
    effective_id: &str,
) -> Result<ScannedContribution, String> {
    let effective_id = effective_id.trim();
    if effective_id.is_empty() {
        return Err("item id is required".into());
    }
    scan_all_items(app)
        .contributions
        .into_iter()
        .find(|c| c.effective_id == effective_id && c.zone.is_mutable())
        .ok_or_else(|| format!("editable item \"{effective_id}\" not found"))
}

/// Install a `.spk` (or unpacked item folder) into `packs/installed/<type>/<publisherId>.<id>/`.
/// When `path` is omitted, opens a file picker.
#[tauri::command]
pub fn install_item(
    app: AppHandle,
    path: Option<String>,
) -> Result<Option<InstallItemResult>, String> {
    packs::ensure_packs_ready(&app)?;

    let source = match path {
        Some(p) => {
            let trimmed = p.trim();
            if trimmed.is_empty() {
                return Err("item path is empty".into());
            }
            PathBuf::from(trimmed)
        }
        None => {
            let picked = rfd::FileDialog::new()
                .set_title("Import")
                .add_filter("Spiral item", &["spk"])
                .add_filter("Zip archive", &["zip"])
                .pick_file();
            match picked {
                Some(p) => p,
                None => return Ok(None),
            }
        }
    };

    install_item_from_path(&app, &source).map(Some)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemExportDefaults {
    pub effective_id: String,
    pub item_type: String,
    pub publisher_id: String,
    pub name: String,
    pub version: String,
    pub description: String,
}

/// Defaults for the export metadata prompt (the authoring item's manifest).
#[tauri::command]
pub fn get_item_export_defaults(
    app: AppHandle,
    item_id: String,
) -> Result<ItemExportDefaults, String> {
    let item = find_mutable_item(&app, &item_id)?;
    let manifest = read_export_defaults(&item.contribution_dir)?;
    let suggested_version = if manifest.version == "0.0.0" {
        "1.0.0".to_string()
    } else {
        manifest.version.clone()
    };
    Ok(ItemExportDefaults {
        effective_id: manifest.effective_id(),
        item_type: manifest.item_type,
        publisher_id: manifest.publisher_id,
        name: manifest.name,
        version: suggested_version,
        description: manifest.description,
    })
}

/// Export a workshop or linked item to a `.spk` build artifact. Leaves the source untouched.
#[tauri::command]
pub fn export_item(
    app: AppHandle,
    item_id: String,
    name: String,
    version: String,
    description: Option<String>,
) -> Result<Option<ExportItemResult>, String> {
    packs::ensure_packs_ready(&app)?;
    let item = find_mutable_item(&app, &item_id)?;

    let metadata = ExportItemMetadata {
        name,
        version,
        description: description.unwrap_or_default(),
    };

    let default_name = format!(
        "{}-{}{}",
        item_dir_name(&item.publisher_id, &item.local_id),
        metadata.version.trim(),
        PACK_ARCHIVE_EXTENSION
    );
    let dest = rfd::FileDialog::new()
        .set_title("Export")
        .set_file_name(&default_name)
        .add_filter("Spiral item", &["spk"])
        .save_file();

    let dest = match dest {
        Some(p) => p,
        None => return Ok(None),
    };

    let dest = if dest
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("spk"))
    {
        dest
    } else {
        dest.with_extension("spk")
    };

    export_item_dir_to_spk(&item.contribution_dir, &metadata, &dest).map(Some)
}

/// List all items (builtin / workshop / installed / linked) for the management UI.
#[tauri::command]
pub fn list_items(app: AppHandle) -> Result<Vec<ItemSummary>, String> {
    let hidden = hidden_item_set(&app);
    packs::manage::list_items(&app, &hidden)
}

/// Link an external item folder (directory picker when `path` is omitted).
/// Returns the canonical path, or `None` if the picker was cancelled.
#[tauri::command]
pub fn link_item_folder(app: AppHandle, path: Option<String>) -> Result<Option<String>, String> {
    packs::ensure_packs_ready(&app)?;

    let source = match path {
        Some(p) => {
            let trimmed = p.trim();
            if trimmed.is_empty() {
                return Err("item path is empty".into());
            }
            PathBuf::from(trimmed)
        }
        None => {
            let picked = rfd::FileDialog::new()
                .set_title("Link an Item Folder")
                .pick_folder();
            match picked {
                Some(p) => p,
                None => return Ok(None),
            }
        }
    };

    if !source.is_dir() {
        return Err("linked path must be a directory".into());
    }
    let item = read_item_manifest(&source).map_err(|e| {
        format!("folder is not an item root (pick the folder holding theme.json, skin.json, viz.json or sound.json): {e}")
    })?;
    let effective_id = item.effective_id();

    if workshop_item_ids(&app).contains(&effective_id) {
        return Err(format!(
            "\"{effective_id}\" collides with an existing workshop item; unlink or rename one before linking"
        ));
    }

    let normalized = normalize_linked_path(&source)?;

    let mut app_settings = settings::read_settings(&app);
    for existing in &app_settings.linked_item_paths {
        let existing_path = PathBuf::from(existing.trim());
        if paths_equal_canonical(&existing_path, &source) {
            return Err("that folder is already linked".into());
        }
        if peek_item_effective_id(&existing_path).is_ok_and(|id| id == effective_id) {
            return Err(format!(
                "\"{effective_id}\" is already linked from another folder"
            ));
        }
    }

    app_settings.linked_item_paths.push(normalized.clone());
    settings::write_settings(&app, &app_settings)?;
    Ok(Some(normalized))
}

/// Remove a path from `linkedItemPaths`. Never deletes the folder on disk.
#[tauri::command]
pub fn unlink_item(app: AppHandle, path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("item path is required".into());
    }
    let target = PathBuf::from(trimmed);
    let effective_id = peek_item_effective_id(&target).ok();

    let mut app_settings = settings::read_settings(&app);
    let before = app_settings.linked_item_paths.len();
    app_settings.linked_item_paths.retain(|stored| {
        let stored_path = PathBuf::from(stored.trim());
        !paths_equal_canonical(&stored_path, &target)
    });
    if app_settings.linked_item_paths.len() == before {
        return Err("linked item path not found in settings".into());
    }
    settings::write_settings(&app, &app_settings)?;

    if let Some(effective_id) = effective_id {
        forget_item_references(&app, &effective_id)?;
    }
    Ok(())
}

/// Return current scan warning messages (e.g. misplaced items, linked/workshop collisions).
#[tauri::command]
pub fn get_item_scan_warnings(app: AppHandle) -> Result<Vec<String>, String> {
    packs::ensure_packs_ready(&app)?;
    let scan = scan_all_items(&app);
    Ok(scan.warnings.into_iter().map(|w| w.message).collect())
}

/// Update an authoring item's identity and display fields in its manifest.
///
/// Workshop items are moved to the directory matching a new `publisherId`/`id`; linked items
/// are edited in place and never renamed. Active/hidden references follow an id change.
/// Returns the item's effective id after the update.
#[tauri::command]
pub fn update_item_metadata(
    app: AppHandle,
    item_id: String,
    new_id: String,
    publisher_id: String,
    name: String,
    version: String,
    description: String,
) -> Result<String, String> {
    packs::ensure_packs_ready(&app)?;
    let item = find_mutable_item(&app, &item_id)?;

    let new_id = new_id.trim();
    let publisher_id = publisher_id.trim();
    if new_id.is_empty() {
        return Err("id is required".into());
    }
    if publisher_id.is_empty() {
        return Err("publisherId is required".into());
    }
    if name.trim().is_empty() {
        return Err("name is required".into());
    }
    if version.trim().is_empty() {
        return Err("version is required".into());
    }

    let manifest_path = &item.manifest_path;
    let text = fs::read_to_string(manifest_path)
        .map_err(|e| format!("failed to read {}: {e}", manifest_path.display()))?;
    let mut value: serde_json::Value =
        serde_json::from_str(text.strip_prefix('\u{feff}').unwrap_or(&text))
            .map_err(|e| format!("{} is not valid JSON: {e}", manifest_path.display()))?;
    let obj = value
        .as_object_mut()
        .ok_or_else(|| format!("{} must be a JSON object", manifest_path.display()))?;
    obj.insert("id".into(), new_id.into());
    obj.insert("publisherId".into(), publisher_id.into());
    obj.insert("name".into(), name.trim().into());
    obj.insert("version".into(), version.trim().into());
    obj.insert("description".into(), description.trim().into());

    // Same contract as install: kebab slugs, semver, etc.
    let parsed = parse_item_manifest_value(&item.r#type, &value).map_err(|e| e.to_string())?;
    let new_effective = parsed.effective_id();
    let changed_identity = new_effective != item.effective_id;

    let existing = scan_all_items(&app);
    if changed_identity
        && existing
            .contributions
            .iter()
            .any(|c| c.effective_id == new_effective && c.zone.is_mutable())
    {
        return Err(format!("\"{new_effective}\" already exists"));
    }

    let new_dir = if item.zone == PackZone::Workshop && changed_identity {
        let dest = item
            .contribution_dir
            .parent()
            .ok_or_else(|| "workshop item has no parent directory".to_string())?
            .join(parsed.dir_name());
        if dest.exists() {
            return Err(format!("\"{new_effective}\" already exists"));
        }
        Some(dest)
    } else {
        None
    };

    let json = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("failed to serialize manifest: {e}"))?;
    fs::write(manifest_path, format!("{json}\n"))
        .map_err(|e| format!("failed to write {}: {e}", manifest_path.display()))?;

    if let Some(dest) = new_dir {
        if let Err(e) = fs::rename(&item.contribution_dir, &dest) {
            // Best-effort restore so the draft keeps its previous identity.
            let _ = fs::write(manifest_path, text);
            return Err(format!(
                "failed to move \"{}\" → \"{new_effective}\": {e}",
                item.effective_id
            ));
        }
    }

    if changed_identity {
        remap_item_references(&app, &item.effective_id, &new_effective)?;
    }
    Ok(new_effective)
}

/// Largest manifest the Studio contents view will read.
const MAX_MANIFEST_BYTES: u64 = 8 * 1024 * 1024;

/// An item folder's manifest as JSON, whatever its type.
fn read_manifest_value(dir: &Path) -> Result<serde_json::Value, String> {
    let item_type = detect_item_type(dir)?;
    let filename = item_manifest_filename(item_type).expect("detected type has a filename");
    let path = dir.join(filename);
    let meta = fs::metadata(&path).map_err(|e| format!("failed to read {filename}: {e}"))?;
    if meta.len() > MAX_MANIFEST_BYTES {
        return Err(format!(
            "{filename} exceeds {MAX_MANIFEST_BYTES} byte limit"
        ));
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("failed to read {filename}: {e}"))?;
    serde_json::from_str(text.strip_prefix('\u{feff}').unwrap_or(&text))
        .map_err(|e| format!("{filename} is not valid JSON: {e}"))
}

/// The manifest (`theme.json`, `skin.json`, `viz.json` or `sound.json`) of any known
/// item, for the Studio contents view.
#[tauri::command]
pub fn read_item_manifest_json(
    app: AppHandle,
    item_dir: String,
) -> Result<serde_json::Value, String> {
    let dir = resolve_known_item_dir(&app, &item_dir)?;
    read_manifest_value(&dir)
}

/// Read optional item-root `README.md`. Returns `None` when the file is absent.
#[tauri::command]
pub fn read_item_readme(app: AppHandle, item_dir: String) -> Result<Option<String>, String> {
    let dir = resolve_known_item_dir(&app, &item_dir)?;
    read_item_text_at(&dir, PACK_README_FILENAME, PACK_README_MAX_BYTES)
}

/// Create, update, or remove item-root `README.md` for workshop or linked items.
/// Whitespace-only content deletes the file so the About tab stays empty.
#[tauri::command]
pub fn write_item_readme(app: AppHandle, item_dir: String, content: String) -> Result<(), String> {
    write_item_text_at(
        &app,
        &item_dir,
        PACK_README_FILENAME,
        PACK_README_MAX_BYTES,
        content,
        "README can only be edited for workshop or linked items",
    )
}

/// Read optional item-root `CHANGELOG.md`. Returns `None` when the file is absent.
#[tauri::command]
pub fn read_item_changelog(app: AppHandle, item_dir: String) -> Result<Option<String>, String> {
    let dir = resolve_known_item_dir(&app, &item_dir)?;
    read_item_text_at(&dir, PACK_CHANGELOG_FILENAME, PACK_CHANGELOG_MAX_BYTES)
}

/// Create, update, or remove item-root `CHANGELOG.md` for workshop or linked items.
/// Whitespace-only content deletes the file so the Changelog tab stays empty.
#[tauri::command]
pub fn write_item_changelog(
    app: AppHandle,
    item_dir: String,
    content: String,
) -> Result<(), String> {
    write_item_text_at(
        &app,
        &item_dir,
        PACK_CHANGELOG_FILENAME,
        PACK_CHANGELOG_MAX_BYTES,
        content,
        "CHANGELOG can only be edited for workshop or linked items",
    )
}

/// Reset active selections and drop the hidden entry for a single item id.
pub(crate) fn forget_item_references(app: &AppHandle, item_id: &str) -> Result<(), String> {
    let mut app_settings = settings::read_settings(app);
    let mut changed = false;

    if app_settings.active_theme == item_id {
        app_settings.active_theme = settings::DEFAULT_THEME_ID.to_string();
        changed = true;
    }
    if app_settings.active_skin == item_id {
        app_settings.active_skin = settings::DEFAULT_SKIN_ID.to_string();
        changed = true;
    }
    if app_settings.active_visualizer == item_id {
        app_settings.active_visualizer = settings::DEFAULT_VISUALIZER_ID.to_string();
        changed = true;
    }
    if app_settings.active_sound_pack == item_id {
        app_settings.active_sound_pack = settings::DEFAULT_SOUND_PACK_ID.to_string();
        changed = true;
    }

    let before_hidden = app_settings.hidden_contribution_ids.len();
    app_settings
        .hidden_contribution_ids
        .retain(|id| id != item_id);
    if app_settings.hidden_contribution_ids.len() != before_hidden {
        changed = true;
    }

    if changed {
        settings::write_settings(app, &app_settings)?;
    }
    Ok(())
}

/// Remap a single item's effective id in settings (identity change).
pub(crate) fn remap_item_references(
    app: &AppHandle,
    old_effective_id: &str,
    new_effective_id: &str,
) -> Result<(), String> {
    if old_effective_id == new_effective_id {
        return Ok(());
    }
    let mut app_settings = settings::read_settings(app);
    let mut changed = false;

    for active in [
        &mut app_settings.active_theme,
        &mut app_settings.active_skin,
        &mut app_settings.active_visualizer,
        &mut app_settings.active_sound_pack,
    ] {
        if active == old_effective_id {
            *active = new_effective_id.to_string();
            changed = true;
        }
    }

    for id in app_settings.hidden_contribution_ids.iter_mut() {
        if id == old_effective_id {
            *id = new_effective_id.to_string();
            changed = true;
        }
    }

    if changed {
        settings::write_settings(app, &app_settings)?;
    }
    Ok(())
}

/// Delete an installed item. Builtin, workshop and linked items are rejected.
#[tauri::command]
pub fn uninstall_item(app: AppHandle, item_id: String) -> Result<(), String> {
    packs::ensure_packs_ready(&app)?;
    let item_id = item_id.trim();
    uninstall_installed_item(&app, item_id)?;
    forget_item_references(&app, item_id)
}

/// Delete a workshop draft. Linked items are never deleted from disk — unlink them instead.
#[tauri::command]
pub fn delete_workshop_item(app: AppHandle, item_id: String) -> Result<(), String> {
    packs::ensure_packs_ready(&app)?;

    let item = find_mutable_item(&app, &item_id)?;
    if item.zone != PackZone::Workshop {
        return Err("linked items are not deleted from disk; unlink them instead".into());
    }

    fs::remove_dir_all(&item.contribution_dir)
        .map_err(|e| format!("failed to delete \"{}\": {e}", item.effective_id))?;
    forget_item_references(&app, &item.effective_id)
}

/// Hide or show an item in pickers (does not delete files).
#[tauri::command]
pub fn set_item_hidden(
    app: AppHandle,
    item_id: String,
    hidden: bool,
) -> Result<Vec<String>, String> {
    let item_id = item_id.trim().to_string();
    if item_id.is_empty() {
        return Err("item id is required".into());
    }

    let mut app_settings = settings::read_settings(&app);
    let mut set: HashSet<String> = app_settings
        .hidden_contribution_ids
        .iter()
        .cloned()
        .collect();
    if hidden {
        set.insert(item_id.clone());
    } else {
        set.remove(&item_id);
    }
    let mut ids: Vec<String> = set.into_iter().collect();
    ids.sort();
    app_settings.hidden_contribution_ids = ids.clone();

    // If we hid the active item, fall back to a visible default.
    if hidden {
        if app_settings.active_theme == item_id {
            app_settings.active_theme = settings::DEFAULT_THEME_ID.to_string();
        }
        if app_settings.active_skin == item_id {
            app_settings.active_skin = settings::DEFAULT_SKIN_ID.to_string();
        }
        if app_settings.active_visualizer == item_id {
            app_settings.active_visualizer = settings::DEFAULT_VISUALIZER_ID.to_string();
        }
        if app_settings.active_sound_pack == item_id {
            app_settings.active_sound_pack = settings::DEFAULT_SOUND_PACK_ID.to_string();
        }
    }

    settings::write_settings(&app, &app_settings)?;
    Ok(ids)
}

/// Preferences → Studio → Default Publisher ID.
#[tauri::command]
pub fn get_default_publisher_id(app: AppHandle) -> Result<String, String> {
    Ok(default_publisher_id(&app))
}

/// Persist Default Publisher ID (kebab slug). Empty input reseeds from the OS username.
#[tauri::command]
pub fn save_default_publisher_id(app: AppHandle, publisher_id: String) -> Result<String, String> {
    let trimmed = publisher_id.trim();
    let resolved = if trimmed.is_empty() {
        settings::slugify_os_username()
    } else {
        let slug = slugify_id(trimmed);
        if !is_kebab_slug(&slug) {
            return Err(format!(
                "publisherId must be a kebab-case slug, got: {slug}"
            ));
        }
        slug
    };

    let mut app_settings = settings::read_settings(&app);
    app_settings.default_publisher_id = resolved.clone();
    settings::write_settings(&app, &app_settings)?;
    Ok(resolved)
}

/// Create a new workshop item directory, returning `(dir, id)`.
/// Used by the type-specific scaffolders (e.g. new theme).
pub(crate) fn scaffold_workshop_item_dir(
    app: &AppHandle,
    item_type: &str,
    publisher_id: &str,
    base_id: &str,
) -> Result<(PathBuf, String), String> {
    let workshop = ensure_workshop_root(app)?;
    let folder =
        item_type_folder(item_type).ok_or_else(|| format!("unknown item type \"{item_type}\""))?;
    let type_root = workshop.join(folder);
    let id = unique_item_id(&type_root, publisher_id, base_id);
    let dir = type_root.join(item_dir_name(publisher_id, &id));
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create workshop item dir: {e}"))?;
    debug_assert!(item_manifest_filename(item_type).is_some());
    Ok((dir, id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("spiral-items-{label}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_the_manifest_for_any_item_type() {
        let dir = temp_dir("manifest");
        fs::write(
            dir.join("sound.json"),
            "\u{feff}{\"id\":\"x\",\"sounds\":{}}",
        )
        .unwrap();
        let value = read_manifest_value(&dir).unwrap();
        assert_eq!(value["id"], "x");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn manifest_read_rejects_non_items_and_bad_json() {
        let dir = temp_dir("manifest-bad");
        assert!(read_manifest_value(&dir)
            .unwrap_err()
            .contains("no item manifest"));
        fs::write(dir.join("theme.json"), "{oops").unwrap();
        assert!(read_manifest_value(&dir)
            .unwrap_err()
            .contains("not valid JSON"));
        let _ = fs::remove_dir_all(&dir);
    }
}
