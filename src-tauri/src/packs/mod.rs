//! Spiral pack (`pack.json` / `.spk`) — app lifecycle (zones, install, scan) on top of
//! [`spk_format`](https://github.com/spiral-powered/spk-format).
//!
//! See `docs/guides/spiral-pack-format.md`.

pub mod export;
pub mod install;
pub mod manage;
mod paths;
pub mod registry;
pub mod scan;
pub mod workshop_watch;

pub use export::ExportPackResult;
pub use install::InstallPackResult;
pub use manage::PackSummary;
pub use paths::{
    builtin_packs_root, ensure_packs_ready, ensure_workshop_root, installed_packs_root,
    workshop_packs_root,
};
pub use scan::{scan_contributions_of_type, ScannedContribution};
pub use workshop_watch::start_workshop_watch;

// Re-export the shared pack-format crate so call sites keep `packs::…` paths.
pub use spk_format::{
    cleanup_pack_extract_dir, contribution_id_from_manifest_json, contribution_type_for_folder,
    effective_contribution_id, extract_pack_archive, find_pack_root, get_contribution_type_handler,
    is_kebab_slug, pack_id_prefix, pack_identity, parse_pack_manifest_json, slugify_id,
    write_pack_archive, PackManifest, CONTRIBUTION_TYPE_FOLDERS, PACK_ARCHIVE_EXTENSION,
    PACK_CHANGELOG_FILENAME, PACK_CHANGELOG_MAX_BYTES, PACK_MANIFEST_FILENAME,
    PACK_MANIFEST_VERSION, PACK_README_FILENAME, PACK_README_MAX_BYTES,
};

use serde::{Deserialize, Serialize};
use std::path::Path;

/// Fan-out contribution validation used by install / export / registry install.
pub(crate) fn validate_contribution(
    contrib_type: &str,
    _pack_dir: &Path,
    manifest_path: &Path,
) -> Result<(), String> {
    match contrib_type {
        "theme" => spk_format::validate_theme_contribution_at(manifest_path),
        "skin" => spk_format::validate_skin_contribution_at(manifest_path),
        "visualizer" => spk_format::validate_visualizer_contribution_at(manifest_path),
        "sound" => spk_format::validate_sound_contribution_at(manifest_path),
        other => Err(format!("unknown contribution type \"{other}\"")),
    }
}

/// Lifecycle zone a pack was scanned from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PackZone {
    Builtin,
    Workshop,
    Installed,
    /// External pack root listed in `linkedPackPaths` (observed, not owned).
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

    /// Authoring class: workshop drafts and linked external packs.
    pub fn is_mutable(self) -> bool {
        matches!(self, PackZone::Workshop | PackZone::Linked)
    }

    pub fn is_builtin(self) -> bool {
        matches!(self, PackZone::Builtin)
    }
}
