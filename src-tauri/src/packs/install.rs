//! Atomic pack install into `packs/installed/<packId>@<version>/`.

use super::archive::{cleanup_pack_extract_dir, extract_pack_archive, find_pack_root};
use super::paths::{ensure_packs_ready, installed_packs_root};
use super::scan::{app_version, meets_min_app_version};
use super::{
    contribution_id_from_manifest_json, get_contribution_type_handler, parse_pack_manifest_json,
    PackManifest, CONTRIBUTION_TYPE_FOLDERS, PACK_MANIFEST_FILENAME,
};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPackResult {
    pub pack_id: String,
    pub version: String,
    pub name: String,
    pub pack_dir: String,
    pub contribution_count: usize,
}

/// Directory name for an installed pack version: `<packId>@<version>`.
pub fn installed_pack_dirname(pack_id: &str, version: &str) -> String {
    format!("{pack_id}@{version}")
}

pub fn installed_pack_path(installed_root: &Path, pack_id: &str, version: &str) -> PathBuf {
    installed_root.join(installed_pack_dirname(pack_id, version))
}

/// Validate pack.json + contribution files for install (strict).
/// `validate_contribution` is called with (type, pack_dir, manifest_path).
pub fn validate_pack_for_install<F>(
    pack_dir: &Path,
    validate_contribution: F,
) -> Result<PackManifest, String>
where
    F: Fn(&str, &Path, &Path) -> Result<(), String>,
{
    let manifest_path = pack_dir.join(PACK_MANIFEST_FILENAME);
    if !manifest_path.is_file() {
        return Err(format!(
            "pack is missing {PACK_MANIFEST_FILENAME} at {}",
            pack_dir.display()
        ));
    }

    let contents = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("failed to read {PACK_MANIFEST_FILENAME}: {e}"))?;
    let pack = parse_pack_manifest_json(&contents).map_err(|e| e.to_string())?;

    if let Some(min) = &pack.min_app_version {
        if !meets_min_app_version(min, app_version()) {
            return Err(format!(
                "pack \"{}\" requires minAppVersion {min} (app is {})",
                pack.pack_id,
                app_version()
            ));
        }
    }

    let contributions = collect_install_contributions(pack_dir, &pack)?;
    if contributions.is_empty() {
        return Err(format!(
            "pack \"{}\" has no contributions",
            pack.pack_id
        ));
    }

    for (contrib_type, rel_path, manifest) in &contributions {
        if get_contribution_type_handler(contrib_type).is_none() {
            return Err(format!(
                "pack \"{}\": unknown contribution type \"{contrib_type}\" at {rel_path}",
                pack.pack_id
            ));
        }

        validate_contribution(contrib_type, pack_dir, manifest).map_err(|e| {
            format!(
                "pack \"{}\": invalid {contrib_type} contribution at {rel_path}: {e}",
                pack.pack_id
            )
        })?;
    }

    Ok(pack)
}

/// Count contributions under type folders (for install/export results).
pub fn count_pack_contributions(pack_dir: &Path) -> usize {
    let mut count = 0;
    for &(folder, _, manifest_filename) in CONTRIBUTION_TYPE_FOLDERS {
        let type_root = pack_dir.join(folder);
        if !type_root.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&type_root) else {
            continue;
        };
        for entry in entries.flatten() {
            let contribution_dir = entry.path();
            if contribution_dir.is_dir() && contribution_dir.join(manifest_filename).is_file() {
                count += 1;
            }
        }
    }
    count
}

/// Whether any contribution manifests remain under type folders.
pub fn pack_has_contributions(pack_dir: &Path) -> bool {
    count_pack_contributions(pack_dir) > 0
}

fn collect_install_contributions(
    pack_dir: &Path,
    pack: &PackManifest,
) -> Result<Vec<(String, String, PathBuf)>, String> {
    let mut out = Vec::new();
    let mut seen_type_local_ids: HashMap<String, PathBuf> = HashMap::new();

    for &(folder, contrib_type, manifest_filename) in CONTRIBUTION_TYPE_FOLDERS {
        let type_root = pack_dir.join(folder);
        if !type_root.is_dir() {
            continue;
        }
        let entries = fs::read_dir(&type_root).map_err(|e| {
            format!(
                "pack \"{}\": could not read {folder}/: {e}",
                pack.pack_id
            )
        })?;
        for entry in entries.flatten() {
            let contribution_dir = entry.path();
            if !contribution_dir.is_dir() {
                continue;
            }
            let contrib_manifest = contribution_dir.join(manifest_filename);
            if !contrib_manifest.is_file() {
                continue;
            }
            let contents = fs::read_to_string(&contrib_manifest).map_err(|e| {
                format!(
                    "pack \"{}\": could not read {}: {e}",
                    pack.pack_id,
                    contrib_manifest.display()
                )
            })?;
            let local_id = contribution_id_from_manifest_json(&contents).map_err(|e| {
                format!(
                    "pack \"{}\": {}: {e}",
                    pack.pack_id,
                    contrib_manifest.display()
                )
            })?;
            let type_local_key = format!("{contrib_type}:{local_id}");
            if let Some(existing) = seen_type_local_ids.get(&type_local_key) {
                return Err(format!(
                    "pack \"{}\": duplicate {contrib_type} contribution id \"{local_id}\" at {} and {}",
                    pack.pack_id,
                    existing.display(),
                    contrib_manifest.display()
                ));
            }
            seen_type_local_ids.insert(type_local_key, contrib_manifest.clone());
            let rel = contrib_manifest
                .strip_prefix(pack_dir)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| contrib_manifest.to_string_lossy().into_owned());
            out.push((contrib_type.to_string(), rel, contrib_manifest));
        }
    }

    Ok(out)
}

/// Copy a validated pack directory into a staging folder under `installed/`, then rename atomically.
pub(crate) fn atomic_install_pack_dir(
    installed_root: &Path,
    source_pack_dir: &Path,
    pack: &PackManifest,
) -> Result<PathBuf, String> {
    fs::create_dir_all(installed_root)
        .map_err(|e| format!("failed to create installed packs directory: {e}"))?;

    let dest = installed_pack_path(installed_root, &pack.pack_id, &pack.version);
    if dest.exists() {
        return Err(format!(
            "{} ({}) is already installed",
            pack.name, pack.version
        ));
    }

    let staging = installed_root.join(format!(
        ".staging-{}-{}-{}",
        pack.pack_id,
        pack.version.replace(['+', '/'], "_"),
        std::process::id()
    ));
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .map_err(|e| format!("failed to clear staging directory: {e}"))?;
    }

    copy_dir_recursive(source_pack_dir, &staging).map_err(|e| {
        let _ = fs::remove_dir_all(&staging);
        e
    })?;

    // Final check — another install may have raced.
    if dest.exists() {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!(
            "{} ({}) is already installed",
            pack.name, pack.version
        ));
    }

    match fs::rename(&staging, &dest) {
        Ok(()) => Ok(dest),
        Err(e) => {
            let _ = fs::remove_dir_all(&staging);
            Err(format!(
                "failed to install pack into {}: {e}",
                dest.display()
            ))
        }
    }
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest)
        .map_err(|e| format!("failed to create {}: {e}", dest.display()))?;

    for entry in fs::read_dir(src).map_err(|e| format!("failed to read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("failed to read directory entry: {e}"))?;
        let path = entry.path();
        let name = entry.file_name();
        let target = dest.join(&name);
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else if path.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
            }
            fs::copy(&path, &target).map_err(|e| {
                format!(
                    "failed to copy {} → {}: {e}",
                    path.display(),
                    target.display()
                )
            })?;
        }
    }
    Ok(())
}

/// Install a pack archive (`.spk`) or an unpacked pack directory into `installed/`.
pub fn install_pack_from_path<F>(
    app: &AppHandle,
    path: &Path,
    validate_contribution: F,
) -> Result<InstallPackResult, String>
where
    F: Fn(&str, &Path, &Path) -> Result<(), String>,
{
    ensure_packs_ready(app)?;
    let installed_root = installed_packs_root(app)?;

    let (pack_dir, cleanup): (PathBuf, Option<PathBuf>) = if path.is_dir() {
        (path.to_path_buf(), None)
    } else {
        let extract_dir = extract_pack_archive(path)?;
        match find_pack_root(&extract_dir) {
            Ok(root) => (root, Some(extract_dir)),
            Err(e) => {
                cleanup_pack_extract_dir(&extract_dir);
                return Err(e);
            }
        }
    };

    let result = (|| {
        let pack = validate_pack_for_install(&pack_dir, &validate_contribution)?;
        let contribution_count = count_pack_contributions(&pack_dir);
        let dest = atomic_install_pack_dir(&installed_root, &pack_dir, &pack)?;
        Ok(InstallPackResult {
            pack_id: pack.pack_id,
            version: pack.version,
            name: pack.name,
            pack_dir: dest.to_string_lossy().into_owned(),
            contribution_count,
        })
    })();

    if let Some(extract_dir) = cleanup {
        cleanup_pack_extract_dir(&extract_dir);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::PACK_MANIFEST_VERSION;

    fn write_minimal_theme_pack(root: &Path) {
        fs::create_dir_all(root.join("themes/theme")).unwrap();
        fs::write(
            root.join("themes/theme/theme.json"),
            serde_json::json!({
                "id": "theme",
                "name": "Test Theme",
                "author": "t",
                "description": "",
                "tokens": {
                    "color-bg": "#000",
                    "color-surface": "#111",
                    "color-text-primary": "#fff",
                    "color-text-secondary": "#aaa",
                    "color-accent": "#7b8cde",
                    "color-accent-muted": "#333",
                    "color-border": "#222",
                    "color-danger": "#e06c75",
                    "radius-card": "10px",
                    "radius-button": "6px",
                    "font-ui": "system-ui"
                }
            })
            .to_string(),
        )
        .unwrap();

        let pack = PackManifest {
            manifest_version: PACK_MANIFEST_VERSION,
            pack_id: "test-theme".into(),
            author_id: "test".into(),
            version: "1.0.0".into(),
            name: "Test Theme".into(),
            description: "".into(),
            icon: None,
            min_app_version: None,
        };
        fs::write(
            root.join(PACK_MANIFEST_FILENAME),
            serde_json::to_string_pretty(&pack).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn installed_dirname_includes_version() {
        assert_eq!(
            installed_pack_dirname("midnight-drive", "1.2.3"),
            "midnight-drive@1.2.3"
        );
    }

    #[test]
    fn failed_validation_leaves_no_installed_dir() {
        let root = std::env::temp_dir().join(format!(
            "spiral-install-fail-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let installed = root.join("installed");
        fs::create_dir_all(&installed).unwrap();

        let pack_src = root.join("src");
        write_minimal_theme_pack(&pack_src);
        // Break the theme tokens so validation fails.
        fs::write(
            pack_src.join("themes/theme/theme.json"),
            r#"{"id":"theme","name":"Broken","author":"","description":"","tokens":{}}"#,
        )
        .unwrap();

        let validate_err = validate_pack_for_install(&pack_src, |ty, _pack, manifest| {
            if ty == "theme" {
                let text = fs::read_to_string(manifest).unwrap();
                let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                let tokens = v.get("tokens").and_then(|t| t.as_object()).unwrap();
                if tokens.is_empty() {
                    return Err("missing required tokens".into());
                }
            }
            Ok(())
        })
        .unwrap_err();
        assert!(validate_err.contains("missing required tokens"));
        assert!(!installed.join("test-theme@1.0.0").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn keeps_previous_version_dir_on_update() {
        let root = std::env::temp_dir().join(format!(
            "spiral-install-keep-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let installed = root.join("installed");
        fs::create_dir_all(&installed).unwrap();

        let v1 = root.join("v1");
        write_minimal_theme_pack(&v1);
        let pack_v1 = validate_pack_for_install(&v1, |_, _, _| Ok(())).unwrap();
        let dest_v1 = atomic_install_pack_dir(&installed, &v1, &pack_v1).unwrap();
        assert!(dest_v1.exists());

        let v2 = root.join("v2");
        write_minimal_theme_pack(&v2);
        let mut pack_v2 = validate_pack_for_install(&v2, |_, _, _| Ok(())).unwrap();
        pack_v2.version = "2.0.0".into();
        fs::write(
            v2.join(PACK_MANIFEST_FILENAME),
            serde_json::to_string_pretty(&pack_v2).unwrap(),
        )
        .unwrap();
        let pack_v2 = validate_pack_for_install(&v2, |_, _, _| Ok(())).unwrap();
        let dest_v2 = atomic_install_pack_dir(&installed, &v2, &pack_v2).unwrap();

        assert!(dest_v1.exists(), "previous version must remain");
        assert!(dest_v2.exists());
        assert_ne!(dest_v1, dest_v2);
        let _ = fs::remove_dir_all(&root);
    }
}
