//! Pack install / export / management Tauri commands.

use crate::packs::export::{
    export_pack_dir_to_spk, read_workshop_export_defaults, ExportPackMetadata,
};
use crate::packs::install::{install_pack_from_path, pack_has_contributions};
use crate::packs::manage::{rollback_installed_pack, uninstall_installed_pack};
use crate::packs::scan::scan_all_packs;
use crate::packs::{
    self, builtin_packs_root, ensure_workshop_root, installed_packs_root, is_kebab_slug,
    pack_id_prefix, pack_identity, parse_pack_manifest_json, slugify_id, validate_contribution,
    workshop_packs_root, ExportPackResult, InstallPackResult, PackSummary, PackZone,
    PACK_ARCHIVE_EXTENSION, PACK_CHANGELOG_FILENAME, PACK_CHANGELOG_MAX_BYTES,
    PACK_MANIFEST_FILENAME, PACK_MANIFEST_VERSION, PACK_README_FILENAME, PACK_README_MAX_BYTES,
};
use crate::settings;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Resolve `pack_dir` only if it is a direct child of a known pack zone root,
/// or an absolute path listed in `linkedPackPaths`.
fn resolve_known_pack_dir(app: &AppHandle, pack_dir: &str) -> Result<PathBuf, String> {
    let trimmed = pack_dir.trim();
    if trimmed.is_empty() {
        return Err("pack directory is required".into());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_dir() {
        return Err("pack directory not found".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("invalid pack directory: {e}"))?;

    if !canonical.join(PACK_MANIFEST_FILENAME).is_file() {
        return Err(format!(
            "pack directory is missing {PACK_MANIFEST_FILENAME}"
        ));
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
        if canonical.starts_with(&root_canon)
            && canonical
                .parent()
                .is_some_and(|parent| parent == root_canon)
        {
            return Ok(canonical);
        }
    }

    // Linked packs: exact match against settings paths (canonicalized).
    for raw in settings::read_settings(app).linked_pack_paths {
        let linked = PathBuf::from(raw.trim());
        let Ok(linked_canon) = linked.canonicalize() else {
            continue;
        };
        if linked_canon == canonical {
            return Ok(canonical);
        }
    }

    Err("pack directory is outside known pack roots".into())
}

fn paths_equal_canonical(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => a == b,
    }
}

fn workshop_pack_identities(app: &AppHandle) -> HashSet<String> {
    let mut ids = HashSet::new();
    let Ok(workshop) = workshop_packs_root(app) else {
        return ids;
    };
    let Ok(entries) = fs::read_dir(&workshop) else {
        return ids;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Ok(identity) = crate::packs::scan::peek_pack_identity(&path) {
            ids.insert(identity);
        }
    }
    ids
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

fn resolve_default_author_id(app: &AppHandle) -> String {
    let stored = settings::read_settings(app).default_author_id;
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        settings::slugify_os_username()
    } else {
        trimmed.to_string()
    }
}

fn read_pack_author_id(pack_dir: &Path) -> Result<String, String> {
    let contents = fs::read_to_string(pack_dir.join(PACK_MANIFEST_FILENAME))
        .map_err(|e| format!("failed to read {PACK_MANIFEST_FILENAME}: {e}"))?;
    let pack = parse_pack_manifest_json(&contents).map_err(|e| e.to_string())?;
    Ok(pack.author_id)
}

/// Create an empty workshop pack (pack.json only, no contributions).
#[tauri::command]
pub fn create_workshop_pack(
    app: AppHandle,
    name: String,
    description: String,
) -> Result<String, String> {
    packs::ensure_packs_ready(&app)?;

    let name = name.trim();
    if name.is_empty() {
        return Err("pack name is required".into());
    }
    let description = description.trim();

    let workshop = ensure_workshop_root(&app)?;
    let pack_id = unique_workshop_pack_id(&workshop, &slugify_id(name));
    let pack_dir = workshop.join(&pack_id);
    if pack_dir.exists() {
        return Err(format!("workshop pack \"{pack_id}\" already exists"));
    }

    fs::create_dir_all(&pack_dir)
        .map_err(|e| format!("failed to create workshop pack directory: {e}"))?;

    let author_id = resolve_default_author_id(&app);
    let pack = packs::PackManifest {
        manifest_version: PACK_MANIFEST_VERSION,
        pack_id: pack_id.clone(),
        author_id,
        version: "0.0.0".to_string(),
        name: name.to_string(),
        description: description.to_string(),
        preview: None,
        min_app_version: None,
    };
    write_pack_json(&pack_dir.join(PACK_MANIFEST_FILENAME), &pack)?;
    Ok(pack_id)
}

fn normalize_linked_path(path: &Path) -> Result<String, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("invalid pack directory: {e}"))?;
    Ok(canonical.to_string_lossy().into_owned())
}

fn read_pack_text_at(
    pack_dir: &Path,
    filename: &str,
    max_bytes: u64,
) -> Result<Option<String>, String> {
    let path = pack_dir.join(filename);
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

fn read_readme_at(pack_dir: &Path) -> Result<Option<String>, String> {
    read_pack_text_at(pack_dir, PACK_README_FILENAME, PACK_README_MAX_BYTES)
}

fn read_changelog_at(pack_dir: &Path) -> Result<Option<String>, String> {
    read_pack_text_at(pack_dir, PACK_CHANGELOG_FILENAME, PACK_CHANGELOG_MAX_BYTES)
}

fn authoring_pack_writable(app: &AppHandle, dir: &Path) -> bool {
    let workshop_ok = workshop_packs_root(app)
        .ok()
        .and_then(|root| {
            root.canonicalize()
                .ok()
                .map(|w| dir.starts_with(&w) && dir.parent().is_some_and(|p| p == w))
        })
        .unwrap_or(false);
    let linked_ok = settings::read_settings(app)
        .linked_pack_paths
        .iter()
        .any(|raw| paths_equal_canonical(&PathBuf::from(raw.trim()), dir));
    workshop_ok || linked_ok
}

fn write_pack_text_at(
    app: &AppHandle,
    pack_dir: &str,
    filename: &str,
    max_bytes: u64,
    content: String,
    edit_denied_message: &str,
) -> Result<(), String> {
    packs::ensure_packs_ready(app)?;

    let dir = resolve_known_pack_dir(app, pack_dir)?;
    if !authoring_pack_writable(app, &dir) {
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

fn hidden_contribution_set(app: &AppHandle) -> HashSet<String> {
    settings::read_settings(app)
        .hidden_contribution_ids
        .into_iter()
        .collect()
}

/// Install a `.spk` (or path) into `packs/installed/<authorId>.<packId>@<version>/`.
/// When `path` is omitted, opens a file picker.
#[tauri::command]
pub fn install_pack(
    app: AppHandle,
    path: Option<String>,
) -> Result<Option<InstallPackResult>, String> {
    packs::ensure_packs_ready(&app)?;

    let source = match path {
        Some(p) => {
            let trimmed = p.trim();
            if trimmed.is_empty() {
                return Err("pack path is empty".into());
            }
            std::path::PathBuf::from(trimmed)
        }
        None => {
            let picked = rfd::FileDialog::new()
                .set_title("Import Pack")
                .add_filter("Spiral Pack", &["spk"])
                .add_filter("Zip archive", &["zip"])
                .pick_file();
            match picked {
                Some(p) => p,
                None => return Ok(None),
            }
        }
    };

    let result = install_pack_from_path(&app, &source, validate_contribution)?;
    Ok(Some(result))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkshopExportDefaults {
    pub pack_id: String,
    pub author_id: String,
    pub name: String,
    pub version: String,
    pub description: String,
}

/// Defaults for the export metadata prompt (workshop pack.json).
#[tauri::command]
pub fn get_workshop_export_defaults(
    app: AppHandle,
    pack_id: String,
) -> Result<WorkshopExportDefaults, String> {
    let pack_id = pack_id.trim();
    if pack_id.is_empty() {
        return Err("packId is required".into());
    }
    let workshop = ensure_workshop_root(&app)?;
    let pack_dir = workshop.join(pack_id);
    let pack = read_workshop_export_defaults(&pack_dir)?;
    let suggested_version = if pack.version == "0.0.0" {
        "1.0.0".to_string()
    } else {
        pack.version.clone()
    };
    Ok(WorkshopExportDefaults {
        pack_id: pack.pack_id,
        author_id: pack.author_id,
        name: pack.name,
        version: suggested_version,
        description: pack.description,
    })
}

/// Export a workshop pack to a `.spk` build artifact. Leaves the workshop untouched.
#[tauri::command]
pub fn export_workshop_pack(
    app: AppHandle,
    pack_id: String,
    name: String,
    version: String,
    description: Option<String>,
) -> Result<Option<ExportPackResult>, String> {
    packs::ensure_packs_ready(&app)?;

    let pack_id = pack_id.trim().to_string();
    if pack_id.is_empty() {
        return Err("packId is required".into());
    }

    let workshop = ensure_workshop_root(&app)?;
    let pack_dir = workshop.join(&pack_id);
    if !pack_dir.is_dir() {
        return Err(format!("workshop pack \"{pack_id}\" not found"));
    }

    let metadata = ExportPackMetadata {
        name,
        version,
        description: description.unwrap_or_default(),
    };

    let default_name = format!(
        "{}-{}{}",
        pack_id,
        metadata.version.trim(),
        PACK_ARCHIVE_EXTENSION
    );
    let dest = rfd::FileDialog::new()
        .set_title("Export Pack")
        .set_file_name(&default_name)
        .add_filter("Spiral Pack", &["spk"])
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

    let result = export_pack_dir_to_spk(&pack_dir, &metadata, &dest, validate_contribution)?;
    Ok(Some(result))
}

/// List all packs (builtin / workshop / installed / linked) for management UI.
#[tauri::command]
pub fn list_packs(app: AppHandle) -> Result<Vec<PackSummary>, String> {
    let hidden = hidden_contribution_set(&app);
    packs::manage::list_packs(&app, &hidden)
}

/// Link an external pack folder (directory picker when `path` is omitted).
/// Returns the canonical path, or `None` if the picker was cancelled.
#[tauri::command]
pub fn link_pack_folder(app: AppHandle, path: Option<String>) -> Result<Option<String>, String> {
    packs::ensure_packs_ready(&app)?;

    let source = match path {
        Some(p) => {
            let trimmed = p.trim();
            if trimmed.is_empty() {
                return Err("pack path is empty".into());
            }
            PathBuf::from(trimmed)
        }
        None => {
            let picked = rfd::FileDialog::new()
                .set_title("Link a Pack Folder")
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
    if !source.join(PACK_MANIFEST_FILENAME).is_file() {
        return Err(format!(
            "folder is missing {PACK_MANIFEST_FILENAME} (pick the pack root)"
        ));
    }

    let identity = crate::packs::scan::peek_pack_identity(&source)?;
    if workshop_pack_identities(&app).contains(&identity) {
        return Err(format!(
            "pack \"{identity}\" collides with an existing workshop pack; unlink or rename one before linking"
        ));
    }

    let normalized = normalize_linked_path(&source)?;

    let mut app_settings = settings::read_settings(&app);
    for existing in &app_settings.linked_pack_paths {
        let existing_path = PathBuf::from(existing.trim());
        if paths_equal_canonical(&existing_path, &source) {
            return Err("that folder is already linked".into());
        }
    }

    // Also reject if another linked pack already uses this identity.
    for existing in &app_settings.linked_pack_paths {
        let existing_path = PathBuf::from(existing.trim());
        if let Ok(existing_identity) = crate::packs::scan::peek_pack_identity(&existing_path) {
            if existing_identity == identity {
                return Err(format!(
                    "pack \"{identity}\" is already linked from another folder"
                ));
            }
        }
    }

    app_settings.linked_pack_paths.push(normalized.clone());
    settings::write_settings(&app, &app_settings)?;
    Ok(Some(normalized))
}

/// Remove a path from `linkedPackPaths`. Never deletes the folder on disk.
#[tauri::command]
pub fn unlink_pack(app: AppHandle, path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("pack path is required".into());
    }
    let target = PathBuf::from(trimmed);
    let identity = crate::packs::scan::peek_pack_identity(&target).ok();

    let mut app_settings = settings::read_settings(&app);
    let before = app_settings.linked_pack_paths.len();
    app_settings.linked_pack_paths.retain(|stored| {
        let stored_path = PathBuf::from(stored.trim());
        !paths_equal_canonical(&stored_path, &target)
    });
    if app_settings.linked_pack_paths.len() == before {
        return Err("linked pack path not found in settings".into());
    }
    settings::write_settings(&app, &app_settings)?;

    if let Some(identity) = identity {
        // identity is authorId.packId — split for forget prefix.
        if let Some((author_id, pack_id)) = identity.split_once('.') {
            forget_pack_references(&app, author_id, pack_id)?;
        }
    }
    Ok(())
}

/// Return current pack-scan warning messages (e.g. linked/workshop collisions).
#[tauri::command]
pub fn get_pack_scan_warnings(app: AppHandle) -> Result<Vec<String>, String> {
    packs::ensure_packs_ready(&app)?;
    let scan = scan_all_packs(&app);
    Ok(scan.warnings.into_iter().map(|w| w.message).collect())
}

/// Update top-level workshop pack.json fields (packId / authorId / name / version / description).
/// When authorId or packId changes, remaps active/hidden contribution ids that used the old prefix.
#[tauri::command]
pub fn update_workshop_pack_metadata(
    app: AppHandle,
    pack_id: String,
    new_pack_id: String,
    author_id: String,
    name: String,
    version: String,
    description: String,
) -> Result<String, String> {
    packs::ensure_packs_ready(&app)?;

    let pack_id = pack_id.trim();
    if pack_id.is_empty() {
        return Err("packId is required".into());
    }

    let new_pack_id = new_pack_id.trim();
    let author_id = author_id.trim();
    let name = name.trim();
    let version = version.trim();
    let description = description.trim();
    if new_pack_id.is_empty() {
        return Err("packId is required".into());
    }
    if author_id.is_empty() {
        return Err("authorId is required".into());
    }
    if name.is_empty() {
        return Err("pack name is required".into());
    }
    if version.is_empty() {
        return Err("pack version is required".into());
    }

    let workshop = ensure_workshop_root(&app)?;
    let pack_dir = workshop.join(pack_id);
    if !pack_dir.is_dir() {
        return Err(format!("workshop pack \"{pack_id}\" not found"));
    }

    let renaming = new_pack_id != pack_id;
    let dest_dir = workshop.join(new_pack_id);
    if renaming && dest_dir.exists() {
        return Err(format!("workshop pack \"{new_pack_id}\" already exists"));
    }

    let pack_json_path = pack_dir.join(PACK_MANIFEST_FILENAME);
    let contents = fs::read_to_string(&pack_json_path)
        .map_err(|e| format!("failed to read {PACK_MANIFEST_FILENAME}: {e}"))?;
    let mut pack = parse_pack_manifest_json(&contents).map_err(|e| e.to_string())?;
    let old_author_id = pack.author_id.clone();
    let old_pack_id = pack.pack_id.clone();

    pack.pack_id = new_pack_id.to_string();
    pack.author_id = author_id.to_string();
    pack.name = name.to_string();
    pack.version = version.to_string();
    pack.description = description.to_string();

    // Re-parse so packId / authorId / semver and other contract checks apply.
    let json = serde_json::to_string_pretty(&pack)
        .map_err(|e| format!("failed to serialize {PACK_MANIFEST_FILENAME}: {e}"))?;
    let pack = parse_pack_manifest_json(&json).map_err(|e| e.to_string())?;
    write_pack_json(&pack_json_path, &pack)?;

    if renaming {
        if let Err(e) = fs::rename(&pack_dir, &dest_dir) {
            // Best-effort restore of the previous packId so the draft stays findable.
            if let Ok(contents) = fs::read_to_string(&pack_json_path) {
                if let Ok(mut rolled_back) = parse_pack_manifest_json(&contents) {
                    rolled_back.pack_id = pack_id.to_string();
                    rolled_back.author_id = old_author_id.clone();
                    if let Ok(restore_json) = serde_json::to_string_pretty(&rolled_back) {
                        let _ = fs::write(&pack_json_path, format!("{restore_json}\n"));
                    }
                }
            }
            return Err(format!(
                "failed to rename workshop pack \"{pack_id}\" → \"{new_pack_id}\": {e}"
            ));
        }
    }

    if old_author_id != pack.author_id || old_pack_id != pack.pack_id {
        remap_pack_id_references(
            &app,
            &old_author_id,
            &old_pack_id,
            &pack.author_id,
            &pack.pack_id,
        )?;
    }

    Ok(new_pack_id.to_string())
}

/// Update linked pack.json metadata in place. Never renames the folder on disk.
#[tauri::command]
pub fn update_linked_pack_metadata(
    app: AppHandle,
    pack_dir: String,
    new_pack_id: String,
    author_id: String,
    name: String,
    version: String,
    description: String,
) -> Result<String, String> {
    packs::ensure_packs_ready(&app)?;

    let dir = resolve_known_pack_dir(&app, &pack_dir)?;
    let is_linked = settings::read_settings(&app)
        .linked_pack_paths
        .iter()
        .any(|raw| paths_equal_canonical(&PathBuf::from(raw.trim()), &dir));
    if !is_linked {
        return Err("pack directory is not a linked pack".into());
    }

    let new_pack_id = new_pack_id.trim();
    let author_id = author_id.trim();
    let name = name.trim();
    let version = version.trim();
    let description = description.trim();
    if new_pack_id.is_empty() {
        return Err("packId is required".into());
    }
    if author_id.is_empty() {
        return Err("authorId is required".into());
    }
    if name.is_empty() {
        return Err("pack name is required".into());
    }
    if version.is_empty() {
        return Err("pack version is required".into());
    }

    let new_identity = pack_identity(author_id, new_pack_id);
    if workshop_pack_identities(&app).contains(&new_identity) {
        return Err(format!(
            "pack \"{new_identity}\" collides with an existing workshop pack"
        ));
    }

    let pack_json_path = dir.join(PACK_MANIFEST_FILENAME);
    let contents = fs::read_to_string(&pack_json_path)
        .map_err(|e| format!("failed to read {PACK_MANIFEST_FILENAME}: {e}"))?;
    let mut pack = parse_pack_manifest_json(&contents).map_err(|e| e.to_string())?;
    let old_author_id = pack.author_id.clone();
    let old_pack_id = pack.pack_id.clone();

    pack.pack_id = new_pack_id.to_string();
    pack.author_id = author_id.to_string();
    pack.name = name.to_string();
    pack.version = version.to_string();
    pack.description = description.to_string();

    let json = serde_json::to_string_pretty(&pack)
        .map_err(|e| format!("failed to serialize {PACK_MANIFEST_FILENAME}: {e}"))?;
    let pack = parse_pack_manifest_json(&json).map_err(|e| e.to_string())?;
    write_pack_json(&pack_json_path, &pack)?;

    if old_author_id != pack.author_id || old_pack_id != pack.pack_id {
        remap_pack_id_references(
            &app,
            &old_author_id,
            &old_pack_id,
            &pack.author_id,
            &pack.pack_id,
        )?;
    }

    Ok(new_pack_id.to_string())
}

/// Read optional pack-root `README.md`. Returns `None` when the file is absent.
#[tauri::command]
pub fn read_pack_readme(app: AppHandle, pack_dir: String) -> Result<Option<String>, String> {
    let dir = resolve_known_pack_dir(&app, &pack_dir)?;
    read_readme_at(&dir)
}

/// Create, update, or remove pack-root `README.md` for workshop or linked packs.
/// Whitespace-only content deletes the file so the About tab stays empty.
#[tauri::command]
pub fn write_pack_readme(app: AppHandle, pack_dir: String, content: String) -> Result<(), String> {
    write_pack_text_at(
        &app,
        &pack_dir,
        PACK_README_FILENAME,
        PACK_README_MAX_BYTES,
        content,
        "README can only be edited for workshop or linked packs",
    )
}

/// Read optional pack-root `CHANGELOG.md`. Returns `None` when the file is absent.
#[tauri::command]
pub fn read_pack_changelog(app: AppHandle, pack_dir: String) -> Result<Option<String>, String> {
    let dir = resolve_known_pack_dir(&app, &pack_dir)?;
    read_changelog_at(&dir)
}

/// Create, update, or remove pack-root `CHANGELOG.md` for workshop or linked packs.
/// Whitespace-only content deletes the file so the Changelog tab stays empty.
#[tauri::command]
pub fn write_pack_changelog(
    app: AppHandle,
    pack_dir: String,
    content: String,
) -> Result<(), String> {
    write_pack_text_at(
        &app,
        &pack_dir,
        PACK_CHANGELOG_FILENAME,
        PACK_CHANGELOG_MAX_BYTES,
        content,
        "CHANGELOG can only be edited for workshop or linked packs",
    )
}

/// Delete an entire workshop pack directory (all contributions).
#[tauri::command]
pub fn delete_workshop_pack(app: AppHandle, pack_id: String) -> Result<(), String> {
    packs::ensure_packs_ready(&app)?;

    let pack_id = pack_id.trim();
    if pack_id.is_empty() {
        return Err("packId is required".into());
    }

    let workshop = ensure_workshop_root(&app)?;
    let pack_dir = workshop.join(pack_id);
    if !pack_dir.is_dir() {
        return Err(format!("workshop pack \"{pack_id}\" not found"));
    }

    let author_id = read_pack_author_id(&pack_dir)?;
    fs::remove_dir_all(&pack_dir)
        .map_err(|e| format!("failed to delete workshop pack \"{pack_id}\": {e}"))?;
    forget_pack_references(&app, &author_id, pack_id)?;
    Ok(())
}

fn write_pack_json(path: &Path, pack: &packs::PackManifest) -> Result<(), String> {
    let json = serde_json::to_string_pretty(pack)
        .map_err(|e| format!("failed to serialize {PACK_MANIFEST_FILENAME}: {e}"))?;
    fs::write(path, format!("{json}\n"))
        .map_err(|e| format!("failed to write {PACK_MANIFEST_FILENAME}: {e}"))
}

/// Clear active selections and hidden ids that belong to `authorId.packId.`.
fn forget_pack_references(app: &AppHandle, author_id: &str, pack_id: &str) -> Result<(), String> {
    let prefix = pack_id_prefix(author_id, pack_id);
    let mut app_settings = settings::read_settings(app);
    let mut changed = false;

    if app_settings.active_theme.starts_with(&prefix) {
        app_settings.active_theme = settings::DEFAULT_THEME_ID.to_string();
        changed = true;
    }
    if app_settings.active_skin.starts_with(&prefix) {
        app_settings.active_skin = settings::DEFAULT_SKIN_ID.to_string();
        changed = true;
    }
    if app_settings.active_visualizer.starts_with(&prefix) {
        app_settings.active_visualizer = settings::DEFAULT_VISUALIZER_ID.to_string();
        changed = true;
    }

    let before_hidden = app_settings.hidden_contribution_ids.len();
    app_settings
        .hidden_contribution_ids
        .retain(|id| !id.starts_with(&prefix));
    if app_settings.hidden_contribution_ids.len() != before_hidden {
        changed = true;
    }

    if changed {
        settings::write_settings(app, &app_settings)?;
    }
    Ok(())
}

/// Clear active selection / hidden entry for a single contribution id.
pub(crate) fn forget_contribution_references(
    app: &AppHandle,
    contribution_id: &str,
) -> Result<(), String> {
    let mut app_settings = settings::read_settings(app);
    let mut changed = false;

    if app_settings.active_theme == contribution_id {
        app_settings.active_theme = settings::DEFAULT_THEME_ID.to_string();
        changed = true;
    }
    if app_settings.active_skin == contribution_id {
        app_settings.active_skin = settings::DEFAULT_SKIN_ID.to_string();
        changed = true;
    }
    if app_settings.active_visualizer == contribution_id {
        app_settings.active_visualizer = settings::DEFAULT_VISUALIZER_ID.to_string();
        changed = true;
    }

    let before_hidden = app_settings.hidden_contribution_ids.len();
    app_settings
        .hidden_contribution_ids
        .retain(|id| id != contribution_id);
    if app_settings.hidden_contribution_ids.len() != before_hidden {
        changed = true;
    }

    if changed {
        settings::write_settings(app, &app_settings)?;
    }
    Ok(())
}

fn remap_prefixed_id(id: &str, old_prefix: &str, new_prefix: &str) -> Option<String> {
    id.strip_prefix(old_prefix)
        .map(|suffix| format!("{new_prefix}{suffix}"))
}

fn remap_pack_id_references(
    app: &AppHandle,
    old_author_id: &str,
    old_pack_id: &str,
    new_author_id: &str,
    new_pack_id: &str,
) -> Result<(), String> {
    let old_prefix = pack_id_prefix(old_author_id, old_pack_id);
    let new_prefix = pack_id_prefix(new_author_id, new_pack_id);
    if old_prefix == new_prefix {
        return Ok(());
    }

    let mut app_settings = settings::read_settings(app);
    let mut changed = false;

    if let Some(next) = remap_prefixed_id(&app_settings.active_theme, &old_prefix, &new_prefix) {
        app_settings.active_theme = next;
        changed = true;
    }
    if let Some(next) = remap_prefixed_id(&app_settings.active_skin, &old_prefix, &new_prefix) {
        app_settings.active_skin = next;
        changed = true;
    }
    if let Some(next) = remap_prefixed_id(&app_settings.active_visualizer, &old_prefix, &new_prefix)
    {
        app_settings.active_visualizer = next;
        changed = true;
    }

    let mut hidden_changed = false;
    let remapped_hidden: Vec<String> = app_settings
        .hidden_contribution_ids
        .iter()
        .map(|id| {
            if let Some(next) = remap_prefixed_id(id, &old_prefix, &new_prefix) {
                hidden_changed = true;
                next
            } else {
                id.clone()
            }
        })
        .collect();
    if hidden_changed {
        app_settings.hidden_contribution_ids = remapped_hidden;
        changed = true;
    }

    if changed {
        settings::write_settings(app, &app_settings)?;
    }
    Ok(())
}

/// Remap a single contribution's effective id in settings (local id rename).
pub(crate) fn remap_contribution_id_references(
    app: &AppHandle,
    old_effective_id: &str,
    new_effective_id: &str,
) -> Result<(), String> {
    if old_effective_id == new_effective_id {
        return Ok(());
    }
    let mut app_settings = settings::read_settings(app);
    let mut changed = false;

    if app_settings.active_theme == old_effective_id {
        app_settings.active_theme = new_effective_id.to_string();
        changed = true;
    }
    if app_settings.active_skin == old_effective_id {
        app_settings.active_skin = new_effective_id.to_string();
        changed = true;
    }
    if app_settings.active_visualizer == old_effective_id {
        app_settings.active_visualizer = new_effective_id.to_string();
        changed = true;
    }

    let mut hidden_changed = false;
    let remapped_hidden: Vec<String> = app_settings
        .hidden_contribution_ids
        .iter()
        .map(|id| {
            if id == old_effective_id {
                hidden_changed = true;
                new_effective_id.to_string()
            } else {
                id.clone()
            }
        })
        .collect();
    if hidden_changed {
        app_settings.hidden_contribution_ids = remapped_hidden;
        changed = true;
    }

    if changed {
        settings::write_settings(app, &app_settings)?;
    }
    Ok(())
}

/// Uninstall every installed version of a pack (no rollback leftover).
#[tauri::command]
pub fn uninstall_pack(
    app: AppHandle,
    author_id: String,
    pack_id: String,
    version: String,
) -> Result<(), String> {
    packs::ensure_packs_ready(&app)?;
    let author_id = author_id.trim();
    let pack_id = pack_id.trim();
    let version = version.trim();
    if author_id.is_empty() {
        return Err("authorId is required".into());
    }
    uninstall_installed_pack(&app, author_id, pack_id, version)?;
    forget_pack_references(&app, author_id, pack_id)?;
    Ok(())
}

/// Roll back an installed pack by removing newer versions, leaving `version` on disk.
#[tauri::command]
pub fn rollback_pack(
    app: AppHandle,
    author_id: String,
    pack_id: String,
    version: String,
) -> Result<Vec<String>, String> {
    packs::ensure_packs_ready(&app)?;
    let author_id = author_id.trim();
    let pack_id = pack_id.trim();
    let version = version.trim();
    if author_id.is_empty() {
        return Err("authorId is required".into());
    }
    let removed = rollback_installed_pack(&app, author_id, pack_id, version)?;
    // Actives / hidden ids may still point at removed contribution ids from newer versions.
    forget_pack_references(&app, author_id, pack_id)?;
    Ok(removed)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWorkshopContributionResult {
    pub pack_id: String,
    /// True when the pack had no contributions left and was removed.
    pub pack_removed: bool,
}

/// Delete one authoring contribution (workshop or linked). Empty workshop packs
/// are removed from disk; linked pack roots are left in place.
#[tauri::command]
pub fn delete_workshop_contribution(
    app: AppHandle,
    contribution_id: String,
) -> Result<DeleteWorkshopContributionResult, String> {
    packs::ensure_packs_ready(&app)?;

    let contribution_id = contribution_id.trim();
    if contribution_id.is_empty() {
        return Err("contributionId is required".into());
    }

    let scan = scan_all_packs(&app);
    let contrib = scan
        .contributions
        .iter()
        .find(|c| c.effective_id == contribution_id && c.zone.is_mutable())
        .ok_or_else(|| format!("mutable contribution \"{contribution_id}\" not found"))?;

    let pack_id = contrib.pack_id.clone();
    let author_id = contrib.author_id.clone();
    let pack_dir = contrib.pack_dir.clone();
    let zone = contrib.zone;

    fs::remove_dir_all(&contrib.contribution_dir)
        .map_err(|e| format!("failed to delete contribution \"{contribution_id}\": {e}"))?;

    let pack_removed = !pack_has_contributions(&pack_dir) && zone == PackZone::Workshop;
    if pack_removed {
        fs::remove_dir_all(&pack_dir)
            .map_err(|e| format!("failed to delete empty workshop pack \"{pack_id}\": {e}"))?;
        forget_pack_references(&app, &author_id, &pack_id)?;
    } else {
        forget_contribution_references(&app, contribution_id)?;
    }

    Ok(DeleteWorkshopContributionResult {
        pack_id,
        pack_removed,
    })
}

/// Hide or show a contribution in pickers (does not delete pack files).
#[tauri::command]
pub fn set_contribution_hidden(
    app: AppHandle,
    contribution_id: String,
    hidden: bool,
) -> Result<Vec<String>, String> {
    let contribution_id = contribution_id.trim().to_string();
    if contribution_id.is_empty() {
        return Err("contributionId is required".into());
    }

    let mut app_settings = settings::read_settings(&app);
    let mut set: HashSet<String> = app_settings
        .hidden_contribution_ids
        .iter()
        .cloned()
        .collect();
    if hidden {
        set.insert(contribution_id.clone());
    } else {
        set.remove(&contribution_id);
    }
    let mut ids: Vec<String> = set.into_iter().collect();
    ids.sort();
    app_settings.hidden_contribution_ids = ids.clone();

    // If we hid the active contribution, fall back to a visible default.
    if hidden {
        if app_settings.active_theme == contribution_id {
            app_settings.active_theme = settings::DEFAULT_THEME_ID.to_string();
        }
        if app_settings.active_skin == contribution_id {
            app_settings.active_skin = settings::DEFAULT_SKIN_ID.to_string();
        }
        if app_settings.active_visualizer == contribution_id {
            app_settings.active_visualizer = settings::DEFAULT_VISUALIZER_ID.to_string();
        }
    }

    settings::write_settings(&app, &app_settings)?;
    Ok(ids)
}

/// Preferences → Studio → Default Author ID.
#[tauri::command]
pub fn get_default_author_id(app: AppHandle) -> Result<String, String> {
    Ok(resolve_default_author_id(&app))
}

/// Persist Default Author ID (kebab slug). Empty input reseeds from the OS username.
#[tauri::command]
pub fn save_default_author_id(app: AppHandle, author_id: String) -> Result<String, String> {
    let trimmed = author_id.trim();
    let resolved = if trimmed.is_empty() {
        settings::slugify_os_username()
    } else {
        let slug = slugify_id(trimmed);
        if !is_kebab_slug(&slug) {
            return Err(format!("authorId must be a kebab-case slug, got: {slug}"));
        }
        slug
    };

    let mut app_settings = settings::read_settings(&app);
    app_settings.default_author_id = resolved.clone();
    settings::write_settings(&app, &app_settings)?;
    Ok(resolved)
}
