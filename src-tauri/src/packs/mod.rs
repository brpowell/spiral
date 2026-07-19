//! Spiral pack (`pack.json` / `.spk`) contracts — schema v1.
//!
//! Contribution ids are declared in each contribution manifest.
//! Effective id = `authorId.packId.type.contributionId`.
//! Contributions are discovered by scanning type folders (`themes/`, `skins/`, `visualizers/`, `renderers/`).
//! See `docs/guides/spiral-pack-format.md`.

mod archive;
pub mod export;
pub mod install;
pub mod manage;
mod paths;
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

use serde::{Deserialize, Serialize};
use std::path::Path;

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

/// Current pack.json wrapper shape version (`manifestVersion`).
pub const PACK_MANIFEST_VERSION: u32 = 1;

/// Zip artifact extension for distributable packs.
pub const PACK_ARCHIVE_EXTENSION: &str = ".spk";

/// Filename of the pack wrapper manifest inside a pack directory or `.spk`.
pub const PACK_MANIFEST_FILENAME: &str = "pack.json";

/// Optional long-form About body at the pack root (rendered in Studio).
pub const PACK_README_FILENAME: &str = "README.md";

/// Max README.md size accepted for read/write (bytes).
pub const PACK_README_MAX_BYTES: u64 = 256 * 1024;

/// Fixed type-folder → contribution type mapping used by the scanner.
pub const CONTRIBUTION_TYPE_FOLDERS: &[(&str, &str, &str)] = &[
    // (folder name, contribution type, manifest filename)
    ("themes", "theme", "theme.json"),
    ("skins", "skin", "skin.json"),
    ("visualizers", "visualizer", "viz.json"),
    ("renderers", "renderer", "renderer.json"),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackManifest {
    pub manifest_version: u32,
    pub pack_id: String,
    pub author_id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_app_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackManifestError {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for PackManifestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for PackManifestError {}

fn err(code: &'static str, message: impl Into<String>) -> PackManifestError {
    PackManifestError {
        code,
        message: message.into(),
    }
}

/// Full pack identity = `authorId.packId`.
pub fn pack_identity(author_id: &str, pack_id: &str) -> String {
    format!("{author_id}.{pack_id}")
}

/// Effective contribution id = `authorId.packId.type.contributionId`.
pub fn effective_contribution_id(
    author_id: &str,
    pack_id: &str,
    contrib_type: &str,
    contribution_id: &str,
) -> String {
    format!("{author_id}.{pack_id}.{contrib_type}.{contribution_id}")
}

/// Prefix used when remapping settings after an authorId/packId change:
/// `authorId.packId.`
pub fn pack_id_prefix(author_id: &str, pack_id: &str) -> String {
    format!("{author_id}.{pack_id}.")
}

pub fn is_kebab_slug(value: &str) -> bool {
    let mut chars = value.chars().peekable();
    let mut saw_alnum = false;
    while let Some(ch) = chars.next() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            saw_alnum = true;
            continue;
        }
        if ch == '-' {
            if !saw_alnum {
                return false;
            }
            match chars.peek() {
                Some(n) if n.is_ascii_lowercase() || n.is_ascii_digit() => {}
                _ => return false,
            }
            continue;
        }
        return false;
    }
    saw_alnum
}

/// Permissive semver: MAJOR.MINOR.PATCH with optional pre-release / build.
fn is_semver(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    let mut i = 0;
    let mut parts = 0;
    while parts < 3 {
        if i >= bytes.len() || !bytes[i].is_ascii_digit() {
            return false;
        }
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        parts += 1;
        if parts < 3 {
            if i >= bytes.len() || bytes[i] != b'.' {
                return false;
            }
            i += 1;
        }
    }
    if i == bytes.len() {
        return true;
    }
    if bytes[i] != b'-' && bytes[i] != b'+' {
        return false;
    }
    i += 1;
    if i >= bytes.len() {
        return false;
    }
    bytes[i..]
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || *b == b'.' || *b == b'-')
}

/// Fail-fast `manifestVersion` check before full validation.
pub fn assert_pack_manifest_version(value: &serde_json::Value) -> Result<(), PackManifestError> {
    let obj = value
        .as_object()
        .ok_or_else(|| err("invalid_pack_json", "pack.json must be a JSON object"))?;
    let version = obj.get("manifestVersion").ok_or_else(|| {
        err(
            "missing_manifest_version",
            "pack.json is missing manifestVersion",
        )
    })?;
    let version_num = version.as_u64().ok_or_else(|| {
        err(
            "unsupported_manifest_version",
            format!("unsupported pack manifestVersion: {version} (expected {PACK_MANIFEST_VERSION})"),
        )
    })?;
    if version_num != u64::from(PACK_MANIFEST_VERSION) {
        return Err(err(
            "unsupported_manifest_version",
            format!(
                "unsupported pack manifestVersion: {version_num} (expected {PACK_MANIFEST_VERSION})"
            ),
        ));
    }
    Ok(())
}

/// Parse and validate pack.json JSON text against the v1 contract.
pub fn parse_pack_manifest_json(json: &str) -> Result<PackManifest, PackManifestError> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| err("invalid_json", format!("pack.json is not valid JSON: {e}")))?;
    parse_pack_manifest_value(&value)
}

pub fn parse_pack_manifest_value(
    value: &serde_json::Value,
) -> Result<PackManifest, PackManifestError> {
    assert_pack_manifest_version(value)?;

    if value.get("contributions").is_some() {
        return Err(err(
            "contributions_not_allowed",
            "pack.json must not declare contributions[] — contributions are discovered by scanning type folders",
        ));
    }
    if value.get("author").is_some() && value.get("authorId").is_none() {
        return Err(err(
            "author_renamed",
            "pack.json uses authorId (structured slug), not author (freeform). Contribution manifests keep freeform author.",
        ));
    }

    let pack: PackManifest = serde_json::from_value(value.clone()).map_err(|e| {
        err(
            "invalid_pack_json",
            format!("pack.json does not match v1 shape: {e}"),
        )
    })?;

    if !is_kebab_slug(&pack.pack_id) {
        return Err(err(
            "invalid_pack_id",
            format!("packId must be a kebab-case slug, got: {}", pack.pack_id),
        ));
    }
    if !is_kebab_slug(&pack.author_id) {
        return Err(err(
            "invalid_author_id",
            format!(
                "authorId must be a kebab-case slug, got: {}",
                pack.author_id
            ),
        ));
    }
    if pack.name.trim().is_empty() {
        return Err(err(
            "invalid_field",
            "pack.json field \"name\" must be a non-empty string",
        ));
    }
    if !is_semver(&pack.version) {
        return Err(err(
            "invalid_version",
            format!("version must be semver, got: {}", pack.version),
        ));
    }
    if let Some(min) = &pack.min_app_version {
        if !is_semver(min) {
            return Err(err(
                "invalid_min_app_version",
                format!("minAppVersion must be semver when present, got: {min}"),
            ));
        }
    }
    if let Some(icon) = &pack.icon {
        if icon.trim().is_empty() {
            return Err(err(
                "invalid_field",
                "pack.json field \"icon\" must be a non-empty string when present",
            ));
        }
    }

    Ok(pack)
}

/// Read a declared contribution `id` from a contribution manifest JSON object.
pub fn contribution_id_from_manifest_value(
    value: &serde_json::Value,
) -> Result<String, PackManifestError> {
    let id = value
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            err(
                "missing_contribution_id",
                "contribution manifest is missing required id",
            )
        })?;
    if !is_kebab_slug(id) {
        return Err(err(
            "invalid_contribution_id",
            format!("contribution id must be a kebab-case slug, got: {id}"),
        ));
    }
    Ok(id.to_string())
}

pub fn contribution_id_from_manifest_json(json: &str) -> Result<String, PackManifestError> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| err("invalid_json", format!("contribution manifest is not valid JSON: {e}")))?;
    contribution_id_from_manifest_value(&value)
}

/// Known contribution-type handler — registry seam consulted by the scanner.
#[derive(Debug, Clone)]
pub struct ContributionTypeHandler {
    /// Schema id for docs / future validate hooks (`theme-v1`, `skin-v1`, …).
    #[allow(dead_code)]
    pub schema_id: &'static str,
    /// Manifest filename expected inside the contribution folder.
    #[allow(dead_code)]
    pub manifest_filename: &'static str,
}

pub fn get_contribution_type_handler(r#type: &str) -> Option<ContributionTypeHandler> {
    CONTRIBUTION_TYPE_FOLDERS
        .iter()
        .find(|(_, ty, _)| *ty == r#type)
        .map(|(_, _, filename)| {
            let schema_id = match r#type {
                "theme" => "theme-v1",
                "skin" => "skin-v1",
                "visualizer" => "viz-v1",
                "renderer" => "renderer-v1",
                _ => "unknown",
            };
            ContributionTypeHandler {
                schema_id,
                manifest_filename: filename,
            }
        })
}

pub fn contribution_type_for_folder(folder: &str) -> Option<&'static str> {
    CONTRIBUTION_TYPE_FOLDERS
        .iter()
        .find(|(dir, _, _)| *dir == folder)
        .map(|(_, ty, _)| *ty)
}

/// Convenience: whether a path looks like a pack archive (by extension).
pub fn is_pack_archive_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("spk"))
}

/// Slugify free text into a kebab-case id (shared by pack/theme/author defaults).
pub fn slugify_id(input: &str) -> String {
    let mut out = String::new();
    let mut pending_hyphen = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_hyphen && !out.is_empty() {
                out.push('-');
            }
            pending_hyphen = false;
            out.push(ch.to_ascii_lowercase());
        } else if !out.is_empty() {
            pending_hyphen = true;
        }
    }
    if out.is_empty() {
        "untitled".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_PACK: &str = include_str!("../../packs/examples/midnight-drive.pack.json");
    const SCHEMA: &str = include_str!("../../schemas/pack-v1.schema.json");

    #[test]
    fn archive_extension_is_spk() {
        assert_eq!(PACK_ARCHIVE_EXTENSION, ".spk");
        assert_eq!(PACK_MANIFEST_FILENAME, "pack.json");
        assert!(is_pack_archive_path(Path::new("midnight-drive.spk")));
        assert!(!is_pack_archive_path(Path::new("midnight-drive.sp")));
    }

    #[test]
    fn sample_pack_validates_without_contributions() {
        let pack = parse_pack_manifest_json(SAMPLE_PACK).expect("sample pack.json");
        assert_eq!(pack.manifest_version, PACK_MANIFEST_VERSION);
        assert_eq!(pack.pack_id, "midnight-drive");
        assert_eq!(pack.author_id, "bryan");
        assert_eq!(
            effective_contribution_id(&pack.author_id, &pack.pack_id, "theme", "theme"),
            "bryan.midnight-drive.theme.theme"
        );
    }

    #[test]
    fn unsupported_manifest_version_fails_fast() {
        let err = assert_pack_manifest_version(&serde_json::json!({
            "manifestVersion": 99,
            "packId": "x"
        }))
        .expect_err("manifestVersion 99");
        assert_eq!(err.code, "unsupported_manifest_version");
        assert!(err.message.contains("99"));
        assert!(err.message.contains(&PACK_MANIFEST_VERSION.to_string()));
    }

    #[test]
    fn missing_manifest_version_fails_fast() {
        let err = parse_pack_manifest_json(
            r#"{
            "packId": "midnight-drive",
            "authorId": "bryan",
            "version": "1.0.0",
            "name": "X",
            "description": ""
        }"#,
        )
        .expect_err("missing manifestVersion");
        assert_eq!(err.code, "missing_manifest_version");
    }

    #[test]
    fn rejects_legacy_contributions_array() {
        let err = parse_pack_manifest_json(
            r#"{
            "manifestVersion": 1,
            "packId": "midnight-drive",
            "authorId": "bryan",
            "version": "1.0.0",
            "name": "X",
            "description": "",
            "contributions": []
        }"#,
        )
        .expect_err("contributions not allowed");
        assert_eq!(err.code, "contributions_not_allowed");
    }

    #[test]
    fn registry_skips_unknown_types() {
        assert!(get_contribution_type_handler("theme").is_some());
        assert!(get_contribution_type_handler("skin").is_some());
        assert!(get_contribution_type_handler("visualizer").is_some());
        assert!(get_contribution_type_handler("renderer").is_some());
        assert!(get_contribution_type_handler("lyrics-overlay").is_none());
        assert_eq!(contribution_type_for_folder("themes"), Some("theme"));
        assert_eq!(contribution_type_for_folder("renderers"), Some("renderer"));
        assert_eq!(contribution_type_for_folder("lyrics"), None);
    }

    #[test]
    fn schema_is_v1_without_contributions() {
        let schema: serde_json::Value = serde_json::from_str(SCHEMA).unwrap();
        assert_eq!(schema["properties"]["manifestVersion"]["const"], 1);
        assert!(schema["properties"].get("contributions").is_none());
        assert!(schema["properties"].get("authorId").is_some());
        assert!(schema["properties"].get("author").is_none());
        assert!(schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "authorId"));
    }

    #[test]
    fn slugify_id_normalizes() {
        assert_eq!(slugify_id("Bryan H"), "bryan-h");
        assert_eq!(slugify_id("  "), "untitled");
        assert_eq!(slugify_id("T3: Skynet"), "t3-skynet");
    }
}
