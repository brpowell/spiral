//! Spiral items (`theme.json` / `skin.json` / `viz.json` / `sound.json` / `.spk`) — app
//! lifecycle (zones, install, scan) on top of
//! [`spk_format`](https://github.com/brpowell/spiral/tree/main/libs/spk-format).
//!
//! Every theme, skin, visualizer and sound is an individual item stored at
//! `<zone>/<type folder>/<publisherId>.<id>/`.

pub mod export;
pub mod install;
pub mod manage;
mod paths;
pub mod registry;
pub mod scan;
pub mod workshop_watch;

pub use export::ExportItemResult;
pub use install::InstallItemResult;
pub use manage::ItemSummary;
pub use paths::{
    builtin_packs_root, ensure_packs_ready, ensure_workshop_root, installed_packs_root,
    workshop_packs_root,
};
pub use scan::{scan_contributions_of_type, ScannedContribution};
pub use workshop_watch::start_workshop_watch;

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
    Workshop,
    Installed,
    /// External item folder listed in `linkedItemPaths` (observed, not owned).
    Linked,
}

impl PackZone {
    pub fn as_str(self) -> &'static str {
        match self {
            PackZone::Builtin => "builtin",
            PackZone::Workshop => "workshop",
            PackZone::Installed => "installed",
            PackZone::Linked => "linked",
        }
    }

    /// Authoring class: workshop drafts and linked external items.
    pub fn is_mutable(self) -> bool {
        matches!(self, PackZone::Workshop | PackZone::Linked)
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
    fn authoring_zones_are_always_editable() {
        assert!(PackZone::Workshop.is_editable());
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
