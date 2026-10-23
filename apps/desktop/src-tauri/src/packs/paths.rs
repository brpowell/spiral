//! Zone roots for item scanning (builtin / installed / the Spiral Library's `Packs` folder).

use crate::settings;
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

/// Builtin items shipped with the app under `packs/builtin/<type folder>/<publisherId>.<id>/`.
pub fn builtin_packs_root(app: &AppHandle) -> PathBuf {
    let manifest_builtin = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("packs/builtin");

    // Dev builds prefer the live source tree so edits apply without bundling
    // resources (build.rs clears bundle.resources when `tauri_build::is_dev()`;
    // src-tauri/.taurignore keeps the CLI from rebuilding on pack file changes).
    #[cfg(debug_assertions)]
    if manifest_builtin.is_dir() {
        return manifest_builtin;
    }

    if let Ok(path) = app.path().resolve("packs/builtin", BaseDirectory::Resource) {
        if path.is_dir() {
            return path;
        }
    }
    manifest_builtin
}

pub fn packs_app_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings::app_data_dir(app)?.join("packs"))
}

/// Folder inside the Spiral Library that holds the user's own items, scanned as linked.
pub const LIBRARY_PACKS_DIR_NAME: &str = "Packs";

/// `<library root>/Packs/<type folder>/<publisherId>.<id>/`.
pub fn library_packs_root(app: &AppHandle) -> Result<PathBuf, String> {
    let resolved = settings::resolved_library_settings(app);
    Ok(PathBuf::from(resolved.library_root).join(LIBRARY_PACKS_DIR_NAME))
}

/// Pre-Library location of the user's own items (`{app_data}/packs/workshop`).
fn legacy_workshop_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(packs_app_data_root(app)?.join("workshop"))
}

pub fn installed_packs_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(packs_app_data_root(app)?.join("installed"))
}

/// `<zone root>/<type folder>/<publisherId>.<id>/` for an item.
pub fn item_dir_in_zone(
    zone_root: &std::path::Path,
    item_type: &str,
    publisher_id: &str,
    id: &str,
) -> Result<PathBuf, String> {
    let folder = spk_format::item_type_folder(item_type)
        .ok_or_else(|| format!("unknown item type \"{item_type}\""))?;
    Ok(zone_root
        .join(folder)
        .join(spk_format::item_dir_name(publisher_id, id)))
}

pub fn ensure_library_packs_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = library_packs_root(app)?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("failed to create library packs directory: {e}"))?;
    }
    Ok(dir)
}

/// Add `dir` to `linkedItemPaths` unless it is already there. Every user-owned item is a
/// linked path; the Library's `Packs` folder is just the default place new ones are created.
pub fn add_linked_item_path(app: &AppHandle, dir: &std::path::Path) -> Result<(), String> {
    let canonical = dir
        .canonicalize()
        .map_err(|e| format!("invalid item directory: {e}"))?;
    let normalized = canonical.to_string_lossy().into_owned();
    let mut app_settings = settings::read_settings(app);
    let already = app_settings.linked_item_paths.iter().any(|raw| {
        std::path::PathBuf::from(raw.trim())
            .canonicalize()
            .is_ok_and(|p| p == canonical)
    });
    if already {
        return Ok(());
    }
    app_settings.linked_item_paths.push(normalized);
    settings::write_settings(app, &app_settings)?;
    crate::path_scope::allow_dir(app, &canonical);
    Ok(())
}

/// Move items from the legacy workshop folder into `library_root`, returning the item
/// directories now in their new place. Item directories that already exist at the
/// destination are left in place, and the legacy folder is removed only once it is empty.
pub fn migrate_legacy_workshop(
    legacy: &std::path::Path,
    library_root: &std::path::Path,
) -> Vec<PathBuf> {
    let mut moved = Vec::new();
    if !legacy.is_dir() {
        return moved;
    }
    let Ok(type_dirs) = std::fs::read_dir(legacy) else {
        return moved;
    };
    for type_dir in type_dirs.flatten() {
        let from_type = type_dir.path();
        if !from_type.is_dir() {
            continue;
        }
        let to_type = library_root.join(type_dir.file_name());
        if std::fs::create_dir_all(&to_type).is_err() {
            continue;
        }
        let Ok(items) = std::fs::read_dir(&from_type) else {
            continue;
        };
        for item in items.flatten() {
            let to_item = to_type.join(item.file_name());
            if !to_item.exists() && std::fs::rename(item.path(), &to_item).is_ok() {
                moved.push(to_item);
            }
        }
        // Only succeeds when empty.
        let _ = std::fs::remove_dir(&from_type);
    }
    let _ = std::fs::remove_dir(legacy);
    moved
}

/// Ensure the library packs / installed zone roots exist. Call before scanning.
pub fn ensure_packs_ready(app: &AppHandle) -> Result<(), String> {
    let library = ensure_library_packs_root(app)?;
    if let Ok(legacy) = legacy_workshop_root(app) {
        for dir in migrate_legacy_workshop(&legacy, &library) {
            add_linked_item_path(app, &dir)?;
        }
    }
    if let Ok(installed) = installed_packs_root(app) {
        let _ = std::fs::create_dir_all(installed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "spiral-paths-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn migrate_moves_items_and_removes_legacy_dir() {
        let base = temp("migrate");
        let legacy = base.join("workshop");
        let library = base.join("Packs");
        fs::create_dir_all(legacy.join("themes/bryan.one")).unwrap();
        fs::write(legacy.join("themes/bryan.one/theme.json"), "{}").unwrap();
        fs::create_dir_all(&library).unwrap();

        let moved = migrate_legacy_workshop(&legacy, &library);

        assert_eq!(moved, vec![library.join("themes/bryan.one")]);
        assert!(library.join("themes/bryan.one/theme.json").is_file());
        assert!(!legacy.exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn migrate_keeps_items_that_already_exist_in_library() {
        let base = temp("migrate-conflict");
        let legacy = base.join("workshop");
        let library = base.join("Packs");
        fs::create_dir_all(legacy.join("themes/bryan.one")).unwrap();
        fs::write(legacy.join("themes/bryan.one/theme.json"), "old").unwrap();
        fs::create_dir_all(library.join("themes/bryan.one")).unwrap();
        fs::write(library.join("themes/bryan.one/theme.json"), "new").unwrap();

        let moved = migrate_legacy_workshop(&legacy, &library);

        assert!(moved.is_empty());
        assert_eq!(
            fs::read_to_string(library.join("themes/bryan.one/theme.json")).unwrap(),
            "new"
        );
        assert!(legacy.join("themes/bryan.one/theme.json").is_file());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn migrate_is_a_noop_without_legacy_dir() {
        let base = temp("migrate-none");
        let moved = migrate_legacy_workshop(&base.join("workshop"), &base.join("Packs"));
        assert!(moved.is_empty());
        assert!(!base.join("Packs").exists());
        let _ = fs::remove_dir_all(&base);
    }
}
