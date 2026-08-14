//! Pack-level list / uninstall for the Installed Packs management UI.

use super::install::{installed_pack_dirname, installed_pack_path};
use super::paths::{
    builtin_packs_root, ensure_packs_ready, installed_packs_root, workshop_packs_root,
};
use super::scan::{scan_all_packs, scan_zone_root, version_cmp};
use super::{
    contribution_id_from_manifest_json, effective_contribution_id, pack_identity,
    parse_pack_manifest_json, PackZone, CONTRIBUTION_TYPE_FOLDERS, PACK_MANIFEST_FILENAME,
};
use serde::Serialize;
use spk_format::resolve_preview_file;
use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackContributionSummary {
    pub r#type: String,
    pub local_id: String,
    pub effective_id: String,
    pub name: String,
    /// Freeform credit from the contribution manifest (may be empty).
    pub author: String,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackSummary {
    pub pack_id: String,
    pub author_id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    /// Optional pack preview image path relative to the pack root.
    /// Prefer a wide image around 1280×800 (16:10). When omitted in pack.json,
    /// this may be filled with the first contribution preview found on disk.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub zone: PackZone,
    pub pack_dir: String,
    pub contributions: Vec<PackContributionSummary>,
    /// True when at least one contribution from this pack dir wins in the scan registry.
    pub active: bool,
}

fn peek_contribution_fields(manifest_path: &Path) -> (Option<String>, Option<String>) {
    let Ok(contents) = fs::read_to_string(manifest_path) else {
        return (None, None);
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&contents) else {
        return (None, None);
    };
    let peek = |key: &str| {
        value
            .get(key)
            .and_then(|n| n.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    (peek("name"), peek("author"))
}

fn peek_contribution_preview(manifest_path: &Path) -> Option<String> {
    let contents = fs::read_to_string(manifest_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&contents).ok()?;
    value
        .get("preview")
        .and_then(|n| n.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Pack-root-relative path for a contribution preview image, when present.
fn contribution_preview_rel(
    pack_dir: &Path,
    contribution_dir: &Path,
    contrib_manifest: &Path,
) -> Option<String> {
    let explicit = peek_contribution_preview(contrib_manifest);
    let abs = resolve_preview_file(contribution_dir, explicit.as_deref())?;
    let rel = abs.strip_prefix(pack_dir).ok()?;
    Some(rel.to_string_lossy().replace('\\', "/"))
}

/// Effective pack preview: explicit pack.json field, else first contribution preview.
fn resolve_pack_preview(
    declared: Option<&str>,
    contribution_previews: &[Option<String>],
) -> Option<String> {
    if let Some(preview) = declared.map(str::trim).filter(|s| !s.is_empty()) {
        return Some(preview.to_string());
    }
    contribution_previews.iter().find_map(|p| p.clone())
}

fn summarize_pack_dir(
    pack_dir: &Path,
    zone: PackZone,
    hidden: &HashSet<String>,
    active_dirs: &HashSet<PathBuf>,
) -> Option<PackSummary> {
    let manifest_path = pack_dir.join(PACK_MANIFEST_FILENAME);
    if !manifest_path.is_file() {
        return None;
    }
    let contents = fs::read_to_string(&manifest_path).ok()?;
    let pack = parse_pack_manifest_json(&contents).ok()?;

    let mut contributions = Vec::new();
    let mut contribution_previews = Vec::new();
    for &(folder, contrib_type, manifest_filename) in CONTRIBUTION_TYPE_FOLDERS {
        let type_root = pack_dir.join(folder);
        if !type_root.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&type_root) else {
            continue;
        };
        for entry in entries.flatten() {
            let contribution_dir = entry.path();
            if !contribution_dir.is_dir() {
                continue;
            }
            let contrib_manifest = contribution_dir.join(manifest_filename);
            if !contrib_manifest.is_file() {
                continue;
            }
            let Ok(manifest_text) = fs::read_to_string(&contrib_manifest) else {
                continue;
            };
            let Ok(local_id) = contribution_id_from_manifest_json(&manifest_text) else {
                continue;
            };
            let effective_id = effective_contribution_id(
                &pack.author_id,
                &pack.pack_id,
                contrib_type,
                &local_id,
            );
            let (peeked_name, peeked_author) = peek_contribution_fields(&contrib_manifest);
            let name = peeked_name.unwrap_or_else(|| local_id.clone());
            let author = peeked_author.unwrap_or_default();
            contribution_previews.push(contribution_preview_rel(
                pack_dir,
                &contribution_dir,
                &contrib_manifest,
            ));
            contributions.push(PackContributionSummary {
                r#type: contrib_type.to_string(),
                local_id,
                effective_id: effective_id.clone(),
                name,
                author,
                hidden: hidden.contains(&effective_id),
            });
        }
    }

    let preview = resolve_pack_preview(pack.preview.as_deref(), &contribution_previews);

    Some(PackSummary {
        pack_id: pack.pack_id,
        author_id: pack.author_id,
        version: pack.version,
        name: pack.name,
        description: pack.description,
        preview,
        zone,
        pack_dir: pack_dir.to_string_lossy().into_owned(),
        contributions,
        active: active_dirs.contains(pack_dir),
    })
}

fn collect_zone_packs(
    root: &Path,
    zone: PackZone,
    hidden: &HashSet<String>,
    active_dirs: &HashSet<PathBuf>,
) -> Vec<PackSummary> {
    if !root.is_dir() {
        return vec![];
    }
    let Ok(entries) = fs::read_dir(root) else {
        return vec![];
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(summary) = summarize_pack_dir(&path, zone, hidden, active_dirs) {
                out.push(summary);
            }
        }
    }
    out
}

/// List every pack directory across builtin / workshop / installed / linked.
pub fn list_packs(app: &AppHandle, hidden: &HashSet<String>) -> Result<Vec<PackSummary>, String> {
    ensure_packs_ready(app)?;

    let scan = scan_all_packs(app);
    let active_dirs: HashSet<PathBuf> = scan
        .contributions
        .iter()
        .map(|c| c.pack_dir.clone())
        .collect();

    let mut packs = Vec::new();
    packs.extend(collect_zone_packs(
        &builtin_packs_root(app),
        PackZone::Builtin,
        hidden,
        &active_dirs,
    ));
    if let Ok(workshop) = workshop_packs_root(app) {
        packs.extend(collect_zone_packs(
            &workshop,
            PackZone::Workshop,
            hidden,
            &active_dirs,
        ));
    }
    if let Ok(installed) = installed_packs_root(app) {
        packs.extend(collect_zone_packs(
            &installed,
            PackZone::Installed,
            hidden,
            &active_dirs,
        ));
    }

    let linked_paths = crate::settings::read_settings(app).linked_pack_paths;
    for raw in linked_paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = PathBuf::from(trimmed);
        if let Some(summary) = summarize_pack_dir(&path, PackZone::Linked, hidden, &active_dirs) {
            packs.push(summary);
        }
    }

    packs.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.pack_id.cmp(&b.pack_id))
            .then_with(|| {
                version_cmp(&b.version, &a.version).unwrap_or_else(|| b.version.cmp(&a.version))
            })
            .then_with(|| a.zone.as_str().cmp(b.zone.as_str()))
    });

    Ok(packs)
}

fn remove_dir_all_with_context(path: &Path, label: &str) -> Result<(), String> {
    fs::remove_dir_all(path).map_err(|e| format!("failed to delete {label}: {e}"))
}

fn guard_installed_pack_path(app: &AppHandle, pack_dir: &Path) -> Result<(), String> {
    // Guard: never delete builtin / workshop paths even if somehow passed.
    let builtin = builtin_packs_root(app);
    if pack_dir.starts_with(&builtin) {
        return Err("builtin packs cannot be uninstalled".into());
    }
    if let Ok(workshop) = workshop_packs_root(app) {
        if pack_dir.starts_with(&workshop) {
            return Err("workshop packs cannot be uninstalled here; delete the draft instead".into());
        }
    }
    Ok(())
}

/// Every `installed/<authorId>.<packId>@<version>/` directory for a pack identity.
fn installed_version_dirs(
    installed_root: &Path,
    author_id: &str,
    pack_id: &str,
) -> Vec<PathBuf> {
    let identity_prefix = format!("{}@", pack_identity(author_id, pack_id));
    let Ok(entries) = fs::read_dir(installed_root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|name| name.starts_with(&identity_prefix))
        })
        .collect()
}

/// Delete one installed pack version directory. Builtin and workshop are rejected.
fn remove_installed_pack_version(
    app: &AppHandle,
    author_id: &str,
    pack_id: &str,
    version: &str,
) -> Result<(), String> {
    let installed = installed_packs_root(app)?;
    let pack_dir = installed_pack_path(&installed, author_id, pack_id, version);
    if !pack_dir.is_dir() {
        return Err(format!(
            "installed pack \"{}\" not found",
            installed_pack_dirname(author_id, pack_id, version)
        ));
    }
    guard_installed_pack_path(app, &pack_dir)?;
    remove_dir_all_with_context(
        &pack_dir,
        &format!(
            "installed pack \"{}\"",
            installed_pack_dirname(author_id, pack_id, version)
        ),
    )?;
    Ok(())
}

/// Delete every installed version of `authorId.packId`.
/// `version` must currently exist (the UI selection); older kept versions are removed too.
pub fn uninstall_installed_pack(
    app: &AppHandle,
    author_id: &str,
    pack_id: &str,
    version: &str,
) -> Result<(), String> {
    let author_id = author_id.trim();
    let pack_id = pack_id.trim();
    let version = version.trim();
    if author_id.is_empty() {
        return Err("authorId is required".into());
    }
    if pack_id.is_empty() {
        return Err("packId is required".into());
    }
    if version.is_empty() {
        return Err("version is required".into());
    }

    ensure_packs_ready(app)?;
    let installed = installed_packs_root(app)?;
    let selected = installed_pack_path(&installed, author_id, pack_id, version);
    if !selected.is_dir() {
        return Err(format!(
            "installed pack \"{}\" not found",
            installed_pack_dirname(author_id, pack_id, version)
        ));
    }

    let version_dirs = installed_version_dirs(&installed, author_id, pack_id);
    if version_dirs.is_empty() {
        // read_dir failed; still remove the known selection.
        return remove_installed_pack_version(app, author_id, pack_id, version);
    }

    let identity_prefix = format!("{}@", pack_identity(author_id, pack_id));
    for pack_dir in version_dirs {
        let Some(name) = pack_dir.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(dir_version) = name.strip_prefix(&identity_prefix) else {
            continue;
        };
        remove_installed_pack_version(app, author_id, pack_id, dir_version)?;
    }
    Ok(())
}

/// Uninstall every installed version of `authorId.packId` newer than `target_version`, leaving the target.
pub fn rollback_installed_pack(
    app: &AppHandle,
    author_id: &str,
    pack_id: &str,
    target_version: &str,
) -> Result<Vec<String>, String> {
    let author_id = author_id.trim();
    let pack_id = pack_id.trim();
    let target_version = target_version.trim();
    if author_id.is_empty() {
        return Err("authorId is required".into());
    }
    if pack_id.is_empty() {
        return Err("packId is required".into());
    }
    if target_version.is_empty() {
        return Err("version is required".into());
    }

    ensure_packs_ready(app)?;
    let installed = installed_packs_root(app)?;
    let target_dir = installed_pack_path(&installed, author_id, pack_id, target_version);
    if !target_dir.is_dir() {
        return Err(format!(
            "installed pack \"{}\" not found",
            installed_pack_dirname(author_id, pack_id, target_version)
        ));
    }

    let mut warnings = Vec::new();
    let mut removed = Vec::new();
    for contrib in scan_zone_root(&installed, PackZone::Installed, &mut warnings) {
        if contrib.author_id != author_id || contrib.pack_id != pack_id {
            continue;
        }
        match version_cmp(&contrib.pack_version, target_version) {
            Some(Ordering::Greater) => {
                if removed.iter().any(|v| v == &contrib.pack_version) {
                    continue;
                }
                remove_installed_pack_version(app, author_id, pack_id, &contrib.pack_version)?;
                removed.push(contrib.pack_version);
            }
            _ => {}
        }
    }

    if removed.is_empty() {
        return Err(format!(
            "no newer installed versions of \"{}\" to remove (target {target_version})",
            pack_identity(author_id, pack_id)
        ));
    }

    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_pack(dir: &Path, pack_id: &str, version: &str, name: &str) {
        fs::create_dir_all(dir.join("themes/theme")).unwrap();
        fs::write(
            dir.join("pack.json"),
            format!(
                r#"{{
  "manifestVersion": 1,
  "packId": "{pack_id}",
  "authorId": "test",
  "version": "{version}",
  "name": "{name}",
  "description": ""
}}"#
            ),
        )
        .unwrap();
        fs::write(
            dir.join("themes/theme/theme.json"),
            format!(
                r#"{{"id":"theme","name":"Theme {name}","author":"test","description":"","tokens":{{}}}}"#
            ),
        )
        .unwrap();
    }

    #[test]
    fn summarize_reads_contribution_name() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let pack_dir = std::env::temp_dir().join(format!("spiral-pack-manage-test-{nanos}"));
        let _ = fs::remove_dir_all(&pack_dir);
        write_pack(&pack_dir, "demo", "1.0.0", "Demo Pack");
        let hidden = HashSet::new();
        let active = HashSet::from([pack_dir.clone()]);
        let summary = summarize_pack_dir(&pack_dir, PackZone::Installed, &hidden, &active).unwrap();
        assert_eq!(summary.pack_id, "demo");
        assert_eq!(summary.author_id, "test");
        assert_eq!(summary.version, "1.0.0");
        assert!(summary.active);
        assert_eq!(summary.contributions.len(), 1);
        assert_eq!(summary.contributions[0].name, "Theme Demo Pack");
        assert_eq!(summary.contributions[0].author, "test");
        assert_eq!(summary.contributions[0].effective_id, "test.demo.theme.theme");
        assert!(summary.preview.is_none());
        let _ = fs::remove_dir_all(&pack_dir);
    }

    #[test]
    fn summarize_prefers_declared_pack_preview() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let pack_dir = std::env::temp_dir().join(format!("spiral-pack-manage-preview-{nanos}"));
        let _ = fs::remove_dir_all(&pack_dir);
        write_pack(&pack_dir, "demo", "1.0.0", "Demo Pack");
        fs::create_dir_all(pack_dir.join("skins/skin")).unwrap();
        fs::write(
            pack_dir.join("skins/skin/skin.json"),
            r#"{"id":"skin","name":"Skin","author":"test","description":"","preview":"preview.png","canvas":{"width":1,"height":1},"panels":[]}"#,
        )
        .unwrap();
        fs::write(pack_dir.join("skins/skin/preview.png"), b"skin").unwrap();
        fs::write(pack_dir.join("pack-preview.webp"), b"pack").unwrap();
        fs::write(
            pack_dir.join("pack.json"),
            r#"{
  "manifestVersion": 1,
  "packId": "demo",
  "authorId": "test",
  "version": "1.0.0",
  "name": "Demo Pack",
  "description": "",
  "preview": "pack-preview.webp"
}"#,
        )
        .unwrap();
        let hidden = HashSet::new();
        let active = HashSet::new();
        let summary = summarize_pack_dir(&pack_dir, PackZone::Workshop, &hidden, &active).unwrap();
        assert_eq!(summary.preview.as_deref(), Some("pack-preview.webp"));
        let _ = fs::remove_dir_all(&pack_dir);
    }

    #[test]
    fn summarize_defaults_to_first_contribution_preview() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let pack_dir = std::env::temp_dir().join(format!("spiral-pack-manage-auto-{nanos}"));
        let _ = fs::remove_dir_all(&pack_dir);
        write_pack(&pack_dir, "demo", "1.0.0", "Demo Pack");
        fs::create_dir_all(pack_dir.join("skins/skin")).unwrap();
        fs::write(
            pack_dir.join("skins/skin/skin.json"),
            r#"{"id":"skin","name":"Skin","author":"test","description":"","preview":"preview.png","canvas":{"width":1,"height":1},"panels":[]}"#,
        )
        .unwrap();
        fs::write(pack_dir.join("skins/skin/preview.png"), b"skin").unwrap();
        let hidden = HashSet::new();
        let active = HashSet::new();
        let summary = summarize_pack_dir(&pack_dir, PackZone::Workshop, &hidden, &active).unwrap();
        assert_eq!(
            summary.preview.as_deref(),
            Some("skins/skin/preview.png")
        );
        let _ = fs::remove_dir_all(&pack_dir);
    }

    #[test]
    fn summarize_ignores_undeclared_preview_files() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let pack_dir = std::env::temp_dir().join(format!("spiral-pack-manage-undeclared-{nanos}"));
        let _ = fs::remove_dir_all(&pack_dir);
        write_pack(&pack_dir, "demo", "1.0.0", "Demo Pack");
        fs::create_dir_all(pack_dir.join("skins/skin")).unwrap();
        fs::write(
            pack_dir.join("skins/skin/skin.json"),
            r#"{"id":"skin","name":"Skin","author":"test","description":"","canvas":{"width":1,"height":1},"panels":[]}"#,
        )
        .unwrap();
        fs::write(pack_dir.join("skins/skin/preview.png"), b"skin").unwrap();
        let hidden = HashSet::new();
        let active = HashSet::new();
        let summary = summarize_pack_dir(&pack_dir, PackZone::Workshop, &hidden, &active).unwrap();
        assert!(summary.preview.is_none());
        let _ = fs::remove_dir_all(&pack_dir);
    }

    #[test]
    fn installed_version_dirs_finds_all_siblings() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("spiral-pack-uninstall-siblings-{nanos}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let v1 = installed_pack_path(&root, "test", "demo", "1.0.0");
        let v2 = installed_pack_path(&root, "test", "demo", "2.0.0");
        let other = installed_pack_path(&root, "test", "other", "1.0.0");
        write_pack(&v1, "demo", "1.0.0", "Demo v1");
        write_pack(&v2, "demo", "2.0.0", "Demo v2");
        write_pack(&other, "other", "1.0.0", "Other");

        let mut found = installed_version_dirs(&root, "test", "demo");
        found.sort();
        assert_eq!(found, {
            let mut expected = vec![v1, v2];
            expected.sort();
            expected
        });

        let _ = fs::remove_dir_all(&root);
    }
}
