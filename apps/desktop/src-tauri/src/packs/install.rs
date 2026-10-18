//! Atomic item install into `packs/installed/<type folder>/<publisherId>.<id>/`.
//!
//! One version of an item is installed at a time: installing again replaces it.

use super::paths::{ensure_packs_ready, installed_packs_root, item_dir_in_zone};
use super::scan::{app_version, meets_min_app_version};
use super::{
    cleanup_pack_extract_dir, effective_item_id, extract_pack_archive, find_item_root,
    validate_item_dir, ItemManifest,
};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallItemResult {
    pub item_type: String,
    pub id: String,
    pub publisher_id: String,
    pub effective_id: String,
    pub version: String,
    pub name: String,
    pub dir: String,
    /// Version that was replaced, when the item was already installed.
    pub replaced_version: Option<String>,
}

/// The identity a downloaded archive must have. A registry install checks the archive's own
/// manifest against what the catalog promised before it replaces anything on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpectedItem {
    pub publisher_id: String,
    pub item_type: String,
    pub id: String,
    pub version: String,
}

impl ExpectedItem {
    fn check(&self, item: &ItemManifest) -> Result<(), String> {
        if item.publisher_id == self.publisher_id
            && item.item_type == self.item_type
            && item.id == self.id
            && item.version == self.version
        {
            return Ok(());
        }
        Err(format!(
            "downloaded archive is {}@{}, but the registry listed {}@{}",
            item.effective_id(),
            item.version,
            effective_item_id(&self.publisher_id, &self.item_type, &self.id),
            self.version
        ))
    }
}

/// Validate an item directory for install (strict) and check the app version floor.
pub fn validate_item_for_install(item_dir: &Path) -> Result<ItemManifest, String> {
    let item = validate_item_dir(item_dir)?;
    if let Some(min) = &item.min_app_version {
        if !meets_min_app_version(min, app_version()) {
            return Err(format!(
                "{} \"{}\" requires minAppVersion {min} (app is {})",
                item.item_type,
                item.id,
                app_version()
            ));
        }
    }
    Ok(item)
}

/// Copy a validated item directory into a staging folder beside its destination, then
/// swap it into place. An existing install is moved aside first and restored if the swap
/// fails. Returns the destination and the version that was replaced.
pub(crate) fn atomic_install_item_dir(
    installed_root: &Path,
    source_dir: &Path,
    item: &ItemManifest,
) -> Result<(PathBuf, Option<String>), String> {
    let dest = item_dir_in_zone(
        installed_root,
        &item.item_type,
        &item.publisher_id,
        &item.id,
    )?;
    let type_root = dest
        .parent()
        .ok_or_else(|| "installed item has no parent directory".to_string())?
        .to_path_buf();
    fs::create_dir_all(&type_root)
        .map_err(|e| format!("failed to create installed items directory: {e}"))?;

    let tag = format!("{}-{}", item.dir_name(), std::process::id());
    let staging = type_root.join(format!(".staging-{tag}"));
    let backup = type_root.join(format!(".old-{tag}"));
    for leftover in [&staging, &backup] {
        if leftover.exists() {
            fs::remove_dir_all(leftover)
                .map_err(|e| format!("failed to clear {}: {e}", leftover.display()))?;
        }
    }

    copy_dir_recursive(source_dir, &staging).inspect_err(|_| {
        let _ = fs::remove_dir_all(&staging);
    })?;

    let replaced_version = if dest.exists() {
        let previous = super::read_item_manifest(&dest).ok().map(|i| i.version);
        fs::rename(&dest, &backup).map_err(|e| {
            let _ = fs::remove_dir_all(&staging);
            format!("failed to replace {}: {e}", dest.display())
        })?;
        Some(previous.unwrap_or_default())
    } else {
        None
    };

    if let Err(e) = fs::rename(&staging, &dest) {
        let _ = fs::remove_dir_all(&staging);
        if backup.exists() {
            let _ = fs::rename(&backup, &dest);
        }
        return Err(format!(
            "failed to install {} into {}: {e}",
            item.name,
            dest.display()
        ));
    }

    if backup.exists() {
        let _ = fs::remove_dir_all(&backup);
    }
    Ok((dest, replaced_version))
}

pub(crate) fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("failed to create {}: {e}", dest.display()))?;

    for entry in fs::read_dir(src).map_err(|e| format!("failed to read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("failed to read directory entry: {e}"))?;
        let path = entry.path();
        let target = dest.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else if path.is_file() {
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

/// Install an item archive (`.spk`) or an unpacked item directory into `installed/`.
pub fn install_item_from_path(app: &AppHandle, path: &Path) -> Result<InstallItemResult, String> {
    install_item_from_path_expecting(app, path, None)
}

/// Like [`install_item_from_path`], but refuses an archive whose manifest does not match
/// `expected` (used for registry downloads).
pub fn install_item_from_path_expecting(
    app: &AppHandle,
    path: &Path,
    expected: Option<&ExpectedItem>,
) -> Result<InstallItemResult, String> {
    ensure_packs_ready(app)?;
    let installed_root = installed_packs_root(app)?;
    install_item_into(&installed_root, path, expected)
}

fn install_item_into(
    installed_root: &Path,
    path: &Path,
    expected: Option<&ExpectedItem>,
) -> Result<InstallItemResult, String> {
    let (item_dir, cleanup): (PathBuf, Option<PathBuf>) = if path.is_dir() {
        (path.to_path_buf(), None)
    } else {
        let extract_dir = extract_pack_archive(path)?;
        match find_item_root(&extract_dir) {
            Ok(root) => (root, Some(extract_dir)),
            Err(e) => {
                cleanup_pack_extract_dir(&extract_dir);
                return Err(e);
            }
        }
    };

    let result = (|| {
        let item = validate_item_for_install(&item_dir)?;
        if let Some(expected) = expected {
            expected.check(&item)?;
        }
        let (dest, replaced_version) = atomic_install_item_dir(installed_root, &item_dir, &item)?;
        Ok(InstallItemResult {
            effective_id: item.effective_id(),
            item_type: item.item_type,
            id: item.id,
            publisher_id: item.publisher_id,
            version: item.version,
            name: item.name,
            dir: dest.to_string_lossy().into_owned(),
            replaced_version,
        })
    })();

    if let Some(extract_dir) = cleanup {
        cleanup_pack_extract_dir(&extract_dir);
    }

    result
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::fs;
    use std::path::{Path, PathBuf};

    pub fn temp_root(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("spiral-{label}-{nanos}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    /// Write a valid theme item at `dir`.
    pub fn write_theme_item(dir: &Path, author: &str, id: &str, version: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(
            dir.join("theme.json"),
            serde_json::json!({
                "id": id,
                "publisherId": author,
                "version": version,
                "name": format!("Theme {id}"),
                "author": "Test",
                "description": "",
                "tokens": {
                    "color-bg": "#000",
                    "color-surface": "#111",
                    "color-text-primary": "#fff",
                    "color-text-secondary": "#aaa",
                    "color-accent": "#7b8cde",
                    "color-accent-muted": "#556",
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
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;
    use crate::packs::write_pack_archive;

    #[test]
    fn installs_directory_under_type_folder() {
        let root = temp_root("install-dir");
        let src = root.join("src");
        write_theme_item(&src, "bryan", "midnight", "1.0.0");
        let installed = root.join("installed");

        let result = install_item_into(&installed, &src, None).unwrap();
        assert_eq!(result.effective_id, "bryan.theme.midnight");
        assert_eq!(result.replaced_version, None);
        let dest = installed.join("themes/bryan.midnight");
        assert_eq!(Path::new(&result.dir), dest);
        assert!(dest.join("theme.json").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn installs_from_spk_round_trip() {
        let root = temp_root("install-spk");
        let src = root.join("src");
        write_theme_item(&src, "bryan", "midnight", "1.0.0");
        fs::write(src.join("extra.txt"), b"asset").unwrap();
        let spk = root.join("midnight.spk");
        write_pack_archive(&src, &spk).unwrap();
        let installed = root.join("installed");

        let result = install_item_into(&installed, &spk, None).unwrap();
        assert_eq!(result.version, "1.0.0");
        assert!(installed.join("themes/bryan.midnight/extra.txt").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reinstall_replaces_previous_version() {
        let root = temp_root("install-replace");
        let installed = root.join("installed");

        let v1 = root.join("v1");
        write_theme_item(&v1, "bryan", "midnight", "1.0.0");
        fs::write(v1.join("old.txt"), b"old").unwrap();
        install_item_into(&installed, &v1, None).unwrap();

        let v2 = root.join("v2");
        write_theme_item(&v2, "bryan", "midnight", "2.0.0");
        let result = install_item_into(&installed, &v2, None).unwrap();

        assert_eq!(result.replaced_version.as_deref(), Some("1.0.0"));
        let dest = installed.join("themes/bryan.midnight");
        assert!(!dest.join("old.txt").exists(), "old files must not linger");
        assert_eq!(read_version(&dest), "2.0.0");
        let leftovers: Vec<_> = fs::read_dir(installed.join("themes"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(leftovers, vec!["bryan.midnight".to_string()]);
        let _ = fs::remove_dir_all(&root);
    }

    fn read_version(dir: &Path) -> String {
        super::super::read_item_manifest(dir).unwrap().version
    }

    #[test]
    fn different_publishers_same_id_install_side_by_side() {
        let root = temp_root("install-authors");
        let installed = root.join("installed");
        for author in ["alice", "bob"] {
            let src = root.join(author);
            write_theme_item(&src, author, "midnight", "1.0.0");
            install_item_into(&installed, &src, None).unwrap();
        }
        assert!(installed.join("themes/alice.midnight").is_dir());
        assert!(installed.join("themes/bob.midnight").is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn invalid_item_leaves_nothing_installed() {
        let root = temp_root("install-invalid");
        let src = root.join("src");
        fs::create_dir_all(&src).unwrap();
        fs::write(
            src.join("theme.json"),
            r#"{"id":"x","publisherId":"a","version":"1.0.0","name":"X","tokens":{}}"#,
        )
        .unwrap();
        let installed = root.join("installed");

        assert!(install_item_into(&installed, &src, None).is_err());
        assert!(!installed.join("themes").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_item_needing_newer_app() {
        let root = temp_root("install-minapp");
        let src = root.join("src");
        write_theme_item(&src, "bryan", "midnight", "1.0.0");
        let text = fs::read_to_string(src.join("theme.json")).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&text).unwrap();
        value["minAppVersion"] = "999.0.0".into();
        fs::write(src.join("theme.json"), value.to_string()).unwrap();

        let err = install_item_into(&root.join("installed"), &src, None).unwrap_err();
        assert!(err.contains("minAppVersion"), "{err}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_old_pack_archive() {
        let root = temp_root("install-oldpack");
        let src = root.join("src");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("pack.json"), "{}").unwrap();
        let spk = root.join("old.spk");
        write_pack_archive(&src, &spk).unwrap();

        let err = install_item_into(&root.join("installed"), &spk, None).unwrap_err();
        assert!(err.contains("item manifest"), "{err}");
        let _ = fs::remove_dir_all(&root);
    }

    fn expected(publisher: &str, id: &str, version: &str) -> ExpectedItem {
        ExpectedItem {
            publisher_id: publisher.into(),
            item_type: "theme".into(),
            id: id.into(),
            version: version.into(),
        }
    }

    #[test]
    fn expected_identity_allows_a_matching_archive() {
        let root = temp_root("install-expected-ok");
        let src = root.join("src");
        write_theme_item(&src, "bryan", "midnight", "1.0.0");
        let installed = root.join("installed");

        let result = install_item_into(
            &installed,
            &src,
            Some(&expected("bryan", "midnight", "1.0.0")),
        )
        .unwrap();
        assert_eq!(result.effective_id, "bryan.theme.midnight");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn expected_identity_rejects_a_mislabelled_archive_and_keeps_the_install() {
        let root = temp_root("install-expected-bad");
        let installed = root.join("installed");

        let current = root.join("current");
        write_theme_item(&current, "bryan", "midnight", "1.0.0");
        install_item_into(&installed, &current, None).unwrap();

        // The catalog promised bryan.midnight@2.0.0 but the archive is another item entirely.
        let other = root.join("other");
        write_theme_item(&other, "mallory", "evil", "2.0.0");
        let err = install_item_into(
            &installed,
            &other,
            Some(&expected("bryan", "midnight", "2.0.0")),
        )
        .unwrap_err();
        assert!(err.contains("mallory.theme.evil"), "{err}");
        assert!(!installed.join("themes/mallory.evil").exists());

        // Right item, wrong version.
        let stale = root.join("stale");
        write_theme_item(&stale, "bryan", "midnight", "1.5.0");
        let err = install_item_into(
            &installed,
            &stale,
            Some(&expected("bryan", "midnight", "2.0.0")),
        )
        .unwrap_err();
        assert!(err.contains("1.5.0"), "{err}");

        // The installed copy is untouched.
        assert_eq!(
            read_version(&installed.join("themes/bryan.midnight")),
            "1.0.0"
        );
        let _ = fs::remove_dir_all(&root);
    }
}
