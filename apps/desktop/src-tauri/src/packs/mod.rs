//! Spiral items (`theme.json` / `skin.json` / `viz.json` / `sound.json` / `.spk`) — app
//! lifecycle (zones, install, scan) on top of
//! [`spk_format`](https://github.com/brpowell/spiral/tree/main/libs/spk-format).
//!
//! Every theme, skin, visualizer and sound is an individual item stored at
//! `<zone>/<type folder>/<publisherId>.<id>/`.

pub mod export;
pub mod install;
pub mod library_watch;
pub mod manage;
mod paths;
pub mod registry;
pub mod scan;

pub use export::ExportItemResult;
pub use install::InstallItemResult;
pub use library_watch::{retarget_library_packs_watch, start_library_packs_watch};
pub use manage::ItemSummary;
pub use paths::{
    add_linked_item_path, builtin_packs_root, ensure_library_packs_root, ensure_packs_ready,
    installed_packs_root, library_packs_root, LIBRARY_PACKS_DIR_NAME,
};
pub use scan::{scan_contributions_of_type, ScannedContribution};

// Re-export the shared format crate so call sites keep `packs::…` paths.
pub use spk_format::{
    cleanup_extract_dir, effective_item_id, extract_archive, find_item_root, is_kebab_slug,
    item_dir_name, item_manifest_filename, item_type_folder, read_item_manifest, slugify_id,
    validate_item_dir, write_archive, ItemManifest, ARCHIVE_EXTENSION, CHANGELOG_FILENAME,
    CHANGELOG_MAX_BYTES, CONTRIBUTION_TYPE_FOLDERS, README_FILENAME, README_MAX_BYTES,
};

use serde::{Deserialize, Serialize};

/// Lifecycle zone an item was scanned from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PackZone {
    Builtin,
    Installed,
    /// Items the user owns on disk: everything in the Spiral Library's `Packs` folder, plus
    /// external item folders listed in `linkedItemPaths`.
    Linked,
}

impl PackZone {
    pub fn as_str(self) -> &'static str {
        match self {
            PackZone::Builtin => "builtin",
            PackZone::Installed => "installed",
            PackZone::Linked => "linked",
        }
    }

    /// Authoring class: linked items.
    pub fn is_mutable(self) -> bool {
        matches!(self, PackZone::Linked)
    }

    /// Whether Studio may edit items in this zone in place.
    ///
    /// Debug builds also edit built-in items: their root is the live source tree (see
    /// `builtin_packs_root`), so token tweaks land in the repo, ready to commit. Release
    /// builds never write into the app bundle.
    pub fn is_editable(self) -> bool {
        self.is_mutable() || (cfg!(debug_assertions) && self.is_builtin())
    }

    pub fn is_builtin(self) -> bool {
        matches!(self, PackZone::Builtin)
    }
}

#[cfg(test)]
mod zone_tests {
    use super::PackZone;

    #[test]
    fn linked_items_are_always_editable() {
        assert!(PackZone::Linked.is_editable());
    }

    #[test]
    fn installed_items_are_never_editable() {
        assert!(!PackZone::Installed.is_editable());
    }

    #[test]
    fn builtin_items_are_editable_in_debug_builds_only() {
        assert_eq!(PackZone::Builtin.is_editable(), cfg!(debug_assertions));
    }
}
