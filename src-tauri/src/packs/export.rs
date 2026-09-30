//! Export a workshop pack directory to a `.spk` build artifact.

use super::install::validate_pack_for_install;
use super::write_pack_archive;
use super::{parse_pack_manifest_json, PackManifest, PACK_MANIFEST_FILENAME};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPackResult {
    pub path: String,
    pub pack_id: String,
    pub version: String,
}

#[derive(Debug, Clone)]
pub struct ExportPackMetadata {
    pub name: String,
    pub version: String,
    pub description: String,
}

/// Copy workshop pack to a temp dir, stamp export metadata into pack.json, zip to `dest_spk`.
/// Leaves the workshop directory untouched. Does not change `authorId` (set on the pack).
pub fn export_pack_dir_to_spk<F>(
    workshop_pack_dir: &Path,
    metadata: &ExportPackMetadata,
    dest_spk: &Path,
    validate_contribution: F,
) -> Result<ExportPackResult, String>
where
    F: Fn(&str, &Path, &Path) -> Result<(), String>,
{
    if !workshop_pack_dir.is_dir() {
        return Err(format!(
            "workshop pack not found: {}",
            workshop_pack_dir.display()
        ));
    }

    let name = metadata.name.trim();
    let version = metadata.version.trim();
    if name.is_empty() {
        return Err("export requires a non-empty name".into());
    }
    if version.is_empty() {
        return Err("export requires a semver version".into());
    }

    // Validate the workshop contents first (export must be installable).
    let mut pack = validate_pack_for_install(workshop_pack_dir, &validate_contribution)?;

    pack.name = name.to_string();
    pack.version = version.to_string();
    pack.description = metadata.description.trim().to_string();

    // Re-parse stamped fields through the same contract (semver, etc.).
    let stamped_json = serde_json::to_string_pretty(&pack)
        .map_err(|e| format!("failed to serialize export pack.json: {e}"))?;
    let pack = parse_pack_manifest_json(&stamped_json).map_err(|e| e.to_string())?;

    let staging = staging_dir_for_export(&pack.pack_id, &pack.version);
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .map_err(|e| format!("failed to clear export staging directory: {e}"))?;
    }
    fs::create_dir_all(&staging)
        .map_err(|e| format!("failed to create export staging directory: {e}"))?;

    let pack_id = pack.pack_id.clone();
    let version = pack.version.clone();

    let export_result = (|| {
        copy_dir_contents(workshop_pack_dir, &staging)?;
        fs::write(
            staging.join(PACK_MANIFEST_FILENAME),
            format!("{stamped_json}\n"),
        )
        .map_err(|e| format!("failed to write stamped pack.json: {e}"))?;

        // Confirm stamped pack still validates.
        let _ = validate_pack_for_install(&staging, &validate_contribution)?;

        write_pack_archive(&staging, dest_spk)?;
        Ok(ExportPackResult {
            path: dest_spk.to_string_lossy().into_owned(),
            pack_id,
            version,
        })
    })();

    let _ = fs::remove_dir_all(&staging);
    export_result
}

fn staging_dir_for_export(pack_id: &str, version: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "spiral-pack-export-{}-{}-{}",
        pack_id,
        version.replace(['+', '/'], "_"),
        std::process::id()
    ))
}

fn copy_dir_contents(src: &Path, dest: &Path) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| format!("failed to read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("failed to read directory entry: {e}"))?;
        let path = entry.path();
        let target = dest.join(entry.file_name());
        if path.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|e| format!("failed to create {}: {e}", target.display()))?;
            copy_dir_contents(&path, &target)?;
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

/// Read display defaults from a workshop pack.json for the export prompt.
pub fn read_workshop_export_defaults(pack_dir: &Path) -> Result<PackManifest, String> {
    let contents = fs::read_to_string(pack_dir.join(PACK_MANIFEST_FILENAME))
        .map_err(|e| format!("failed to read workshop pack.json: {e}"))?;
    parse_pack_manifest_json(&contents).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packs::install::{atomic_install_pack_dir, validate_pack_for_install};
    use crate::packs::PACK_MANIFEST_VERSION;
    use crate::packs::{extract_pack_archive, find_pack_root};

    fn write_draft_theme_pack(root: &Path) {
        fs::create_dir_all(root.join("themes/theme")).unwrap();
        fs::write(
            root.join("themes/theme/theme.json"),
            serde_json::json!({
                "id": "theme",
                "name": "Draft Theme",
                "author": "",
                "description": "",
                "tokens": {
                    "color-bg": "#000",
                    "color-text-primary": "#fff",
                    "color-accent": "#7b8cde",
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
            pack_id: "draft-theme".into(),
            author_id: "bryan".into(),
            version: "0.0.0".into(),
            name: "Draft Theme".into(),
            description: "".into(),
            preview: None,
            min_app_version: None,
        };
        fs::write(
            root.join(PACK_MANIFEST_FILENAME),
            serde_json::to_string_pretty(&pack).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn export_leaves_workshop_untouched_and_round_trips() {
        let root = std::env::temp_dir().join(format!("spiral-export-rt-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let workshop = root.join("workshop/draft-theme");
        write_draft_theme_pack(&workshop);

        let before = fs::read_to_string(workshop.join(PACK_MANIFEST_FILENAME)).unwrap();

        let spk = root.join("draft-theme-1.2.0.spk");
        let exported = export_pack_dir_to_spk(
            &workshop,
            &ExportPackMetadata {
                name: "Shipped Theme".into(),
                version: "1.2.0".into(),
                description: "exported".into(),
            },
            &spk,
            |_, _, _| Ok(()),
        )
        .unwrap();
        assert_eq!(exported.version, "1.2.0");
        assert!(Path::new(&exported.path).is_file());

        let after = fs::read_to_string(workshop.join(PACK_MANIFEST_FILENAME)).unwrap();
        assert_eq!(
            before, after,
            "workshop pack.json must not change on export"
        );

        let extract = extract_pack_archive(Path::new(&exported.path)).unwrap();
        let pack_root = find_pack_root(&extract).unwrap();
        let stamped = validate_pack_for_install(&pack_root, |_, _, _| Ok(())).unwrap();
        assert_eq!(stamped.version, "1.2.0");
        assert_eq!(stamped.author_id, "bryan");
        assert_eq!(stamped.name, "Shipped Theme");

        let installed = root.join("installed");
        fs::create_dir_all(&installed).unwrap();
        let dest = atomic_install_pack_dir(&installed, &pack_root, &stamped).unwrap();
        assert!(dest.ends_with("bryan.draft-theme@1.2.0"));
        assert!(dest.join("themes/theme/theme.json").is_file());

        crate::packs::cleanup_pack_extract_dir(&extract);
        let _ = fs::remove_dir_all(&root);
    }
}
