//! Pack-level list / uninstall for the Installed Packs management UI.

use super::install::{installed_pack_dirname, installed_pack_path};
use super::paths::{
    builtin_packs_root, ensure_packs_ready, installed_packs_root, workshop_packs_root,
};
use super::scan::{scan_all_packs, scan_zone_root, version_cmp};
use super::{
    contribution_id_from_manifest_json, effective_contribution_id, parse_pack_manifest_json,
    PackZone, CONTRIBUTION_TYPE_FOLDERS, PACK_MANIFEST_FILENAME,
};
use serde::Serialize;
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
    /// Optional pack icon path relative to the pack root.
    /// Prefer a square PNG at 128×128 or 256×256 (256 for sharp 2×).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub zone: PackZone,
    pub pack_dir: String,
    pub contributions: Vec<PackContributionSummary>,
    /// True when at least one contribution from this pack dir wins in the scan registry.
    pub active: bool,
    /// Highest other installed version of the same packId still on disk (for rollback hint).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollback_version: Option<String>,
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

    Some(PackSummary {
        pack_id: pack.pack_id,
        author_id: pack.author_id,
        version: pack.version,
        name: pack.name,
        description: pack.description,
        icon: pack.icon,
        zone,
        pack_dir: pack_dir.to_string_lossy().into_owned(),
        contributions,
        active: active_dirs.contains(pack_dir),
        rollback_version: None,
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

fn attach_rollback_hints(packs: &mut [PackSummary]) {
    // For each installed packId, find versions and set rollback_version on the active (newest) one.
    let mut by_id: std::collections::HashMap<String, Vec<usize>> =
        std::collections::HashMap::new();
    for (index, pack) in packs.iter().enumerate() {
        if pack.zone == PackZone::Installed {
            by_id.entry(pack.pack_id.clone()).or_default().push(index);
        }
    }

    for indices in by_id.values() {
        if indices.len() < 2 {
            continue;
        }
        let mut sorted = indices.clone();
        sorted.sort_by(|&a, &b| {
            version_cmp(&packs[a].version, &packs[b].version)
                .unwrap_or(Ordering::Equal)
                .then_with(|| packs[a].version.cmp(&packs[b].version))
        });
        // Highest version that is active (or the highest overall) can roll back to the next lower.
        let highest = *sorted.last().unwrap();
        if packs[highest].active {
            let previous = sorted[sorted.len() - 2];
            packs[highest].rollback_version = Some(packs[previous].version.clone());
        }
    }
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

    attach_rollback_hints(&mut packs);

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

/// Delete one installed pack version directory. Builtin and workshop are rejected.
pub fn uninstall_installed_pack(
    app: &AppHandle,
    pack_id: &str,
    version: &str,
) -> Result<(), String> {
    let pack_id = pack_id.trim();
    let version = version.trim();
    if pack_id.is_empty() {
        return Err("packId is required".into());
    }
    if version.is_empty() {
        return Err("version is required".into());
    }

    ensure_packs_ready(app)?;
    let installed = installed_packs_root(app)?;
    let pack_dir = installed_pack_path(&installed, pack_id, version);
    if !pack_dir.is_dir() {
        return Err(format!(
            "installed pack \"{}\" not found",
            installed_pack_dirname(pack_id, version)
        ));
    }

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

    remove_dir_all_with_context(
        &pack_dir,
        &format!("installed pack \"{}\"", installed_pack_dirname(pack_id, version)),
    )?;
    Ok(())
}

/// Uninstall every installed version of `pack_id` newer than `target_version`, leaving the target.
pub fn rollback_installed_pack(
    app: &AppHandle,
    pack_id: &str,
    target_version: &str,
) -> Result<Vec<String>, String> {
    let pack_id = pack_id.trim();
    let target_version = target_version.trim();
    if pack_id.is_empty() {
        return Err("packId is required".into());
    }
    if target_version.is_empty() {
        return Err("version is required".into());
    }

    ensure_packs_ready(app)?;
    let installed = installed_packs_root(app)?;
    let target_dir = installed_pack_path(&installed, pack_id, target_version);
    if !target_dir.is_dir() {
        return Err(format!(
            "installed pack \"{}\" not found",
            installed_pack_dirname(pack_id, target_version)
        ));
    }

    let mut warnings = Vec::new();
    let mut removed = Vec::new();
    for contrib in scan_zone_root(&installed, PackZone::Installed, &mut warnings) {
        if contrib.pack_id != pack_id {
            continue;
        }
        match version_cmp(&contrib.pack_version, target_version) {
            Some(Ordering::Greater) => {
                if removed.iter().any(|v| v == &contrib.pack_version) {
                    continue;
                }
                uninstall_installed_pack(app, pack_id, &contrib.pack_version)?;
                removed.push(contrib.pack_version);
            }
            _ => {}
        }
    }

    if removed.is_empty() {
        return Err(format!(
            "no newer installed versions of \"{pack_id}\" to remove (target {target_version})"
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
        let _ = fs::remove_dir_all(&pack_dir);
    }
}
