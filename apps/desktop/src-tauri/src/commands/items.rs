//! Item install / export / management Tauri commands.
//!
//! An item is one theme, skin, visualizer or sound (see [`crate::packs`]).

use crate::packs::export::{export_item_dir_to_spk, read_export_defaults, ExportItemMetadata};
use crate::packs::install::install_item_from_path;
use crate::packs::manage::uninstall_installed_item;
use crate::packs::scan::{peek_item_effective_id, scan_all_items, ScannedContribution};
use crate::packs::{
    self, builtin_packs_root, ensure_library_packs_root, installed_packs_root, is_kebab_slug,
    item_dir_name, item_manifest_filename, item_type_folder, library_packs_root,
    read_item_manifest, slugify_id, ExportItemResult, InstallItemResult, ItemSummary, PackZone,
    ARCHIVE_EXTENSION, CHANGELOG_FILENAME, CHANGELOG_MAX_BYTES, README_FILENAME, README_MAX_BYTES,
};
use crate::settings;
use serde::Serialize;
use spk_format::{detect_item_type, parse_item_manifest_value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Resolve `dir` only if it is an item directory directly under
/// `<zone root>/<type folder>/`, or an absolute path listed in `linkedItemPaths`.
fn resolve_known_item_dir(app: &AppHandle, dir: &str) -> Result<PathBuf, String> {
    let mut roots: Vec<PathBuf> = Vec::with_capacity(2);
    roots.push(builtin_packs_root(app));
    if let Ok(installed) = installed_packs_root(app) {
        roots.push(installed);
    }
    let linked: Vec<PathBuf> = settings::read_settings(app)
        .linked_item_paths
        .iter()
        .map(|raw| PathBuf::from(raw.trim()))
        .collect();
    resolve_item_dir_in(dir, &roots, &linked)
}

fn resolve_item_dir_in(
    dir: &str,
    roots: &[PathBuf],
    linked: &[PathBuf],
) -> Result<PathBuf, String> {
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
    for linked in linked {
        let Ok(linked_canon) = linked.canonicalize() else {
            continue;
        };
        if linked_canon == canonical {
            return Ok(canonical);
        }
    }

    Err("item directory is outside known roots".into())
}

/// The manifest file inside an item directory, for revealing the folder.
fn item_manifest_path(dir: &Path) -> Result<PathBuf, String> {
    let item_type = detect_item_type(dir)?;
    let filename = item_manifest_filename(item_type)
        .ok_or_else(|| format!("unknown item type \"{item_type}\""))?;
    Ok(dir.join(filename))
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

/// Local id for a new item named `name`: its slug, or `<slug>-2`, `-3`… when taken. An item's
/// folder name is not tied to its id, so uniqueness is checked against known items.
fn unique_local_id(app: &AppHandle, item_type: &str, publisher_id: &str, slug: &str) -> String {
    let taken: std::collections::HashSet<String> = scan_all_items(app)
        .contributions
        .into_iter()
        .map(|c| c.effective_id)
        .collect();
    let mut candidate = slug.to_string();
    let mut n = 2;
    while taken.contains(&packs::effective_item_id(
        publisher_id,
        item_type,
        &candidate,
    )) {
        candidate = format!("{slug}-{n}");
        n += 1;
    }
    candidate
}

/// Slug used for a new item's id and default folder name; `item_type` stands in for a blank name.
pub(crate) fn slugify_new_item_id(item_type: &str, name: &str) -> String {
    let slug = slugify_id(name);
    if slug == "untitled" {
        item_type.to_string()
    } else {
        slug
    }
}

/// Default folder for a new item: `<library root>/Packs/<type folder>/<slug>`, with `-2`, `-3`…
/// appended while that folder already exists.
fn default_new_item_dir(app: &AppHandle, item_type: &str, name: &str) -> Result<PathBuf, String> {
    let folder =
        item_type_folder(item_type).ok_or_else(|| format!("unknown item type \"{item_type}\""))?;
    let type_root = library_packs_root(app)?.join(folder);
    let slug = slugify_new_item_id(item_type, name);
    let mut dir = type_root.join(&slug);
    let mut n = 2;
    while dir.exists() {
        dir = type_root.join(format!("{slug}-{n}"));
        n += 1;
    }
    Ok(dir)
}

/// Where the new-item dialog proposes to create an item of `item_type` called `name`.
#[tauri::command]
pub fn default_new_item_location(
    app: AppHandle,
    item_type: String,
    name: String,
) -> Result<String, String> {
    Ok(default_new_item_dir(&app, &item_type, &name)?
        .to_string_lossy()
        .into_owned())
}

/// Show a known item's folder in the file manager. Reveals the manifest inside it
/// rather than opening the folder, because opening a folder named like `foo.app`
/// would launch it on macOS.
#[tauri::command]
pub fn reveal_item_folder(app: AppHandle, item_dir: String) -> Result<(), String> {
    let dir = resolve_known_item_dir(&app, &item_dir)?;
    let manifest = item_manifest_path(&dir)?;
    tauri_plugin_opener::reveal_item_in_dir(&manifest).map_err(|e| e.to_string())
}

/// Pick a folder for a new item (native dialog). `None` when cancelled.
#[tauri::command]
pub fn pick_new_item_folder(start_at: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().set_title("Choose a Folder for the New Item");
    if let Some(start) = start_at {
        // Start in the nearest folder that exists.
        let mut dir = PathBuf::from(start.trim());
        while !dir.is_dir() {
            if !dir.pop() {
                break;
            }
        }
        if dir.is_dir() {
            dialog = dialog.set_directory(dir);
        }
    }
    dialog
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
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
    let linked_ok = settings::read_settings(app)
        .linked_item_paths
        .iter()
        .any(|raw| paths_equal_canonical(&PathBuf::from(raw.trim()), dir));
    let builtin_ok = cfg!(debug_assertions)
        && builtin_packs_root(app)
            .canonicalize()
            .is_ok_and(|b| dir.parent().and_then(Path::parent) == Some(b.as_path()));
    linked_ok || builtin_ok
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

/// The editable item with `effective_id`: a linked item, or a built-in one in debug builds.
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
        .find(|c| c.effective_id == effective_id && c.zone.is_editable())
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

/// Export a linked item to a `.spk` build artifact. Leaves the source untouched.
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
        ARCHIVE_EXTENSION
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

/// List all items (builtin / installed / linked) for the management UI.
#[tauri::command]
pub fn list_items(app: AppHandle) -> Result<Vec<ItemSummary>, String> {
    packs::manage::list_items(&app)
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
    crate::path_scope::allow_dir(&app, Path::new(&normalized));
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

/// Return current scan warning messages (e.g. misplaced items, linked/Library collisions).
#[tauri::command]
pub fn get_item_scan_warnings(app: AppHandle) -> Result<Vec<String>, String> {
    packs::ensure_packs_ready(&app)?;
    let scan = scan_all_items(&app);
    Ok(scan.warnings.into_iter().map(|w| w.message).collect())
}

/// Update an authoring item's identity and display fields in its manifest.
///
/// Linked items are edited in place: their folder name is not tied to their identity, so an id
/// change never renames or moves the folder. Active/hidden references follow an id change.
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
    if changed_identity && item.zone == PackZone::Builtin {
        return Err("built-in item ids cannot be changed".into());
    }

    let existing = scan_all_items(&app);
    if changed_identity
        && existing
            .contributions
            .iter()
            .any(|c| c.effective_id == new_effective && c.zone.is_mutable())
    {
        return Err(format!("\"{new_effective}\" already exists"));
    }

    let json = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("failed to serialize manifest: {e}"))?;
    fs::write(manifest_path, format!("{json}\n"))
        .map_err(|e| format!("failed to write {}: {e}", manifest_path.display()))?;

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
    read_item_text_at(&dir, README_FILENAME, README_MAX_BYTES)
}

/// Create, update, or remove item-root `README.md` for linked items.
/// Whitespace-only content deletes the file so the About tab stays empty.
#[tauri::command]
pub fn write_item_readme(app: AppHandle, item_dir: String, content: String) -> Result<(), String> {
    write_item_text_at(
        &app,
        &item_dir,
        README_FILENAME,
        README_MAX_BYTES,
        content,
        "README can only be edited for linked items",
    )
}

/// Read optional item-root `CHANGELOG.md`. Returns `None` when the file is absent.
#[tauri::command]
pub fn read_item_changelog(app: AppHandle, item_dir: String) -> Result<Option<String>, String> {
    let dir = resolve_known_item_dir(&app, &item_dir)?;
    read_item_text_at(&dir, CHANGELOG_FILENAME, CHANGELOG_MAX_BYTES)
}

/// Create, update, or remove item-root `CHANGELOG.md` for linked items.
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
        CHANGELOG_FILENAME,
        CHANGELOG_MAX_BYTES,
        content,
        "CHANGELOG can only be edited for linked items",
    )
}

/// Reset active selections that point at a single item id.
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

    if changed {
        settings::write_settings(app, &app_settings)?;
    }
    Ok(())
}

/// Delete an installed item. Builtin and linked items are rejected.
#[tauri::command]
pub fn uninstall_item(app: AppHandle, item_id: String) -> Result<(), String> {
    packs::ensure_packs_ready(&app)?;
    let item_id = item_id.trim();
    uninstall_installed_item(&app, item_id)?;
    forget_item_references(&app, item_id)
}

/// Refuse to delete a folder that is clearly more than one item: a git checkout, or a folder
/// holding the user's home directory or Spiral Library.
fn ensure_safe_to_delete(app: &AppHandle, dir: &Path) -> Result<(), String> {
    use tauri::Manager;
    if dir.join(".git").exists() {
        return Err(
            "this folder is a git repository; unlink it and delete it yourself if you want it gone"
                .into(),
        );
    }
    let canonical = dir
        .canonicalize()
        .map_err(|e| format!("invalid item directory: {e}"))?;
    let protected = [
        app.path().home_dir().ok(),
        Some(PathBuf::from(
            settings::resolved_library_settings(app).library_root,
        )),
    ];
    for protected in protected.into_iter().flatten() {
        if protected
            .canonicalize()
            .is_ok_and(|p| p.starts_with(&canonical))
        {
            return Err(
                "refusing to delete a folder that contains your home folder or Spiral Library"
                    .into(),
            );
        }
    }
    Ok(())
}

/// Delete a linked item's folder from disk and unlink it. Use `unlink_item` to leave the
/// files in place.
#[tauri::command]
pub fn delete_linked_item(app: AppHandle, item_id: String) -> Result<(), String> {
    packs::ensure_packs_ready(&app)?;

    let item = find_mutable_item(&app, &item_id)?;
    if item.zone != PackZone::Linked {
        return Err("only linked items can be deleted from disk".into());
    }
    ensure_safe_to_delete(&app, &item.contribution_dir)?;

    let canonical = item
        .contribution_dir
        .canonicalize()
        .map_err(|e| format!("invalid item directory: {e}"))?;
    let mut app_settings = settings::read_settings(&app);
    app_settings
        .linked_item_paths
        .retain(|stored| !paths_equal_canonical(&PathBuf::from(stored.trim()), &canonical));
    settings::write_settings(&app, &app_settings)?;

    fs::remove_dir_all(&canonical)
        .map_err(|e| format!("failed to delete \"{}\": {e}", item.effective_id))?;
    forget_item_references(&app, &item.effective_id)
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

/// Create the folder for a new item and link it, returning `(dir, id)`. `location` is the
/// item folder itself (any name, anywhere); it defaults to the Library's `Packs` folder. An
/// existing folder is only accepted when it is empty.
/// Used by the type-specific scaffolders (e.g. new theme).
pub(crate) fn scaffold_item_dir(
    app: &AppHandle,
    item_type: &str,
    name: &str,
    publisher_id: &str,
    location: Option<&str>,
) -> Result<(PathBuf, String), String> {
    debug_assert!(item_manifest_filename(item_type).is_some());
    let dir = match location.map(str::trim).filter(|l| !l.is_empty()) {
        Some(location) => {
            let dir = PathBuf::from(location);
            if !dir.is_absolute() {
                return Err("the folder must be an absolute path".into());
            }
            dir
        }
        None => {
            ensure_library_packs_root(app)?;
            default_new_item_dir(app, item_type, name)?
        }
    };
    if dir.exists() {
        let empty = dir.is_dir()
            && fs::read_dir(&dir)
                .map_err(|e| format!("failed to read {}: {e}", dir.display()))?
                .next()
                .is_none();
        if !empty {
            return Err(format!(
                "{} already exists and is not an empty folder",
                dir.display()
            ));
        }
    }
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    packs::add_linked_item_path(app, &dir)?;
    let id = unique_local_id(
        app,
        item_type,
        publisher_id,
        &slugify_new_item_id(item_type, name),
    );
    Ok((dir, id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("spiral-items-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn reveal_targets_the_manifest_inside_an_app_named_item_dir() {
        let root = temp_root("reveal");
        let installed = root.join("installed");
        let item = installed.join("themes/foo.app");
        fs::create_dir_all(&item).unwrap();
        fs::write(item.join("theme.json"), b"{}").unwrap();

        let dir = resolve_item_dir_in(item.to_str().unwrap(), &[installed], &[]).unwrap();
        let manifest = item_manifest_path(&dir).unwrap();
        assert_eq!(manifest.file_name().unwrap(), "theme.json");
        assert_eq!(manifest.parent().unwrap(), dir.as_path());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn item_dir_outside_known_roots_is_rejected() {
        let root = temp_root("unknown");
        let installed = root.join("installed");
        fs::create_dir_all(installed.join("themes")).unwrap();
        let stray = root.join("Downloads/themes/evil.app");
        fs::create_dir_all(&stray).unwrap();
        fs::write(stray.join("theme.json"), b"{}").unwrap();

        assert!(resolve_item_dir_in(
            stray.to_str().unwrap(),
            std::slice::from_ref(&installed),
            &[]
        )
        .is_err());
        // Linked folders match exactly.
        assert!(resolve_item_dir_in(
            stray.to_str().unwrap(),
            &[installed],
            std::slice::from_ref(&stray)
        )
        .is_ok());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn new_item_slug_falls_back_to_the_type_for_blank_names() {
        assert_eq!(
            slugify_new_item_id("theme", "My Cool Theme"),
            "my-cool-theme"
        );
        assert_eq!(
            slugify_new_item_id("theme", "obsidian.theme"),
            "obsidian-theme"
        );
        assert_eq!(slugify_new_item_id("theme", "  "), "theme");
    }

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
