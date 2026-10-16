//! Export a workshop (or linked) item directory to a `.spk` build artifact.

use super::install::{copy_dir_recursive, validate_item_for_install};
use super::{item_manifest_filename, write_pack_archive, ItemManifest};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportItemResult {
    pub path: String,
    pub effective_id: String,
    pub version: String,
}

#[derive(Debug, Clone)]
pub struct ExportItemMetadata {
    pub name: String,
    pub version: String,
    pub description: String,
}

/// Copy the item to a temp dir, stamp export metadata into its manifest, and zip to
/// `dest_spk`. Leaves the source directory untouched. `authorId` and `id` are not
/// changed (they identify the item).
pub fn export_item_dir_to_spk(
    item_dir: &Path,
    metadata: &ExportItemMetadata,
    dest_spk: &Path,
) -> Result<ExportItemResult, String> {
    if !item_dir.is_dir() {
        return Err(format!("item not found: {}", item_dir.display()));
    }

    let name = metadata.name.trim();
    let version = metadata.version.trim();
    if name.is_empty() {
        return Err("export requires a non-empty name".into());
    }
    if version.is_empty() {
        return Err("export requires a semver version".into());
    }

    // Validate the source first (export must be installable).
    let item = validate_item_for_install(item_dir)?;
    let manifest_filename =
        item_manifest_filename(&item.item_type).expect("validated item has a known type");

    let staging = staging_dir_for_export(&item);
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .map_err(|e| format!("failed to clear export staging directory: {e}"))?;
    }

    let export_result = (|| {
        copy_dir_recursive(item_dir, &staging)?;
        stamp_manifest(
            &staging.join(manifest_filename),
            name,
            version,
            metadata.description.trim(),
        )?;

        // Confirm the stamped item still validates (semver, etc.).
        let stamped = validate_item_for_install(&staging)?;

        write_pack_archive(&staging, dest_spk)?;
        Ok(ExportItemResult {
            path: dest_spk.to_string_lossy().into_owned(),
            effective_id: stamped.effective_id(),
            version: stamped.version,
        })
    })();

    let _ = fs::remove_dir_all(&staging);
    export_result
}

fn stamp_manifest(path: &Path, name: &str, version: &str, description: &str) -> Result<(), String> {
    let text =
        fs::read_to_string(path).map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let mut value: serde_json::Value = serde_json::from_str(text)
        .map_err(|e| format!("{} is not valid JSON: {e}", path.display()))?;
    let obj = value
        .as_object_mut()
        .ok_or_else(|| format!("{} must be a JSON object", path.display()))?;
    obj.insert("name".into(), name.into());
    obj.insert("version".into(), version.into());
    obj.insert("description".into(), description.into());
    let json = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("failed to serialize stamped manifest: {e}"))?;
    fs::write(path, format!("{json}\n"))
        .map_err(|e| format!("failed to write stamped manifest: {e}"))
}

/// Unique per call, so concurrent exports of the same item never share a directory.
fn staging_dir_for_export(item: &ItemManifest) -> PathBuf {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    std::env::temp_dir().join(format!(
        "spiral-item-export-{}-{}-{}-{}",
        item.dir_name(),
        item.version.replace(['+', '/'], "_"),
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ))
}

/// Read display defaults from an authoring item's manifest for the export prompt.
pub fn read_export_defaults(item_dir: &Path) -> Result<ItemManifest, String> {
    super::read_item_manifest(item_dir)
}

#[cfg(test)]
mod tests {
    use super::super::install::test_support::*;
    use super::super::{extract_pack_archive, find_item_root};
    use super::*;

    #[test]
    fn export_leaves_source_untouched_and_round_trips() {
        let root = temp_root("export-rt");
        let src = root.join("workshop/themes/bryan.draft");
        write_theme_item(&src, "bryan", "draft", "0.0.0");
        let before = fs::read_to_string(src.join("theme.json")).unwrap();

        let spk = root.join("draft-1.2.0.spk");
        let exported = export_item_dir_to_spk(
            &src,
            &ExportItemMetadata {
                name: "Shipped Theme".into(),
                version: "1.2.0".into(),
                description: "exported".into(),
            },
            &spk,
        )
        .unwrap();
        assert_eq!(exported.version, "1.2.0");
        assert_eq!(exported.effective_id, "bryan.theme.draft");
        assert!(Path::new(&exported.path).is_file());
        assert_eq!(
            before,
            fs::read_to_string(src.join("theme.json")).unwrap(),
            "source manifest must not change on export"
        );

        let extract = extract_pack_archive(&spk).unwrap();
        let item_root = find_item_root(&extract).unwrap();
        let stamped = validate_item_for_install(&item_root).unwrap();
        assert_eq!(stamped.version, "1.2.0");
        assert_eq!(stamped.author_id, "bryan");
        assert_eq!(stamped.name, "Shipped Theme");
        assert_eq!(stamped.description, "exported");

        super::super::cleanup_pack_extract_dir(&extract);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn export_rejects_bad_version_and_blank_name() {
        let root = temp_root("export-bad");
        let src = root.join("src");
        write_theme_item(&src, "bryan", "draft", "0.0.0");
        let spk = root.join("x.spk");

        let meta = |name: &str, version: &str| ExportItemMetadata {
            name: name.into(),
            version: version.into(),
            description: String::new(),
        };
        assert!(export_item_dir_to_spk(&src, &meta(" ", "1.0.0"), &spk).is_err());
        assert!(export_item_dir_to_spk(&src, &meta("X", "one"), &spk).is_err());
        assert!(!spk.exists());
        let _ = fs::remove_dir_all(&root);
    }
}
