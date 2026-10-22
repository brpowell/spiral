//! Individual items — one theme, skin, visualizer or sound per directory or `.spk`.
//!
//! An item is the contribution manifest (`theme.json`, `skin.json`, `viz.json`,
//! `sound.json`) at the item root, plus its assets. The manifest carries the item's
//! identity (`publisherId`, `id`) and distribution fields (`version`, `minAppVersion`),
//! so there is no wrapper manifest.
//!
//! Effective id = `publisherId.type.id`. On disk an item lives at
//! `<zone>/<type folder>/<publisherId>.<id>/`.

use crate::manifest::{is_kebab_slug, is_semver, validate_preview_file, validate_preview_relpath};
use crate::{
    validate_skin_contribution_at, validate_sound_contribution_at, validate_theme_contribution_at,
    validate_visualizer_contribution_at, ManifestError, CONTRIBUTION_TYPE_FOLDERS,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Identity and distribution fields read from an item's manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemManifest {
    /// `theme` | `skin` | `visualizer` | `sound`.
    pub item_type: String,
    pub id: String,
    pub publisher_id: String,
    /// Semver content version of this item build.
    pub version: String,
    pub name: String,
    pub description: String,
    /// Freeform credit line; empty when the manifest has none.
    pub author: String,
    /// Raster preview path relative to the item root.
    pub preview: Option<String>,
    pub min_app_version: Option<String>,
}

impl ItemManifest {
    pub fn effective_id(&self) -> String {
        effective_item_id(&self.publisher_id, &self.item_type, &self.id)
    }

    pub fn dir_name(&self) -> String {
        item_dir_name(&self.publisher_id, &self.id)
    }
}

fn err(code: &'static str, message: impl Into<String>) -> ManifestError {
    ManifestError {
        code,
        message: message.into(),
    }
}

/// Effective item id = `publisherId.type.id`.
pub fn effective_item_id(publisher_id: &str, item_type: &str, id: &str) -> String {
    format!("{publisher_id}.{item_type}.{id}")
}

/// Directory name of an item under its type folder: `publisherId.id`.
pub fn item_dir_name(publisher_id: &str, id: &str) -> String {
    format!("{publisher_id}.{id}")
}

/// Prefix shared by every item id of one author and type: `publisherId.type.`.
pub fn item_id_prefix(publisher_id: &str, item_type: &str) -> String {
    format!("{publisher_id}.{item_type}.")
}

/// Type-folder name (`skins`) for an item type (`skin`).
pub fn item_type_folder(item_type: &str) -> Option<&'static str> {
    CONTRIBUTION_TYPE_FOLDERS
        .iter()
        .find(|(_, ty, _)| *ty == item_type)
        .map(|(folder, _, _)| *folder)
}

/// Manifest filename (`skin.json`) for an item type (`skin`).
pub fn item_manifest_filename(item_type: &str) -> Option<&'static str> {
    CONTRIBUTION_TYPE_FOLDERS
        .iter()
        .find(|(_, ty, _)| *ty == item_type)
        .map(|(_, _, file)| *file)
}

/// Item type for a manifest filename (`skin.json` → `skin`).
pub fn item_type_for_manifest_filename(filename: &str) -> Option<&'static str> {
    CONTRIBUTION_TYPE_FOLDERS
        .iter()
        .find(|(_, _, file)| *file == filename)
        .map(|(_, ty, _)| *ty)
}

/// Detect an item directory's type from the manifest file at its root.
/// Errors when none or more than one item manifest is present.
pub fn detect_item_type(dir: &Path) -> Result<&'static str, String> {
    let mut found = Vec::new();
    for &(_, ty, file) in CONTRIBUTION_TYPE_FOLDERS {
        if dir.join(file).is_file() {
            found.push((ty, file));
        }
    }
    match found.as_slice() {
        [(ty, _)] => Ok(ty),
        [] => Err(format!(
            "no item manifest ({}) found at {}",
            manifest_filenames_list(),
            dir.display()
        )),
        many => Err(format!(
            "item at {} has more than one manifest: {}",
            dir.display(),
            many.iter().map(|(_, f)| *f).collect::<Vec<_>>().join(", ")
        )),
    }
}

fn manifest_filenames_list() -> String {
    CONTRIBUTION_TYPE_FOLDERS
        .iter()
        .map(|(_, _, f)| *f)
        .collect::<Vec<_>>()
        .join(", ")
}

fn str_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Parse and validate the identity / distribution fields of an item manifest.
/// Type-specific content is validated separately by [`validate_item_dir`].
pub fn parse_item_manifest_json(
    item_type: &str,
    json: &str,
) -> Result<ItemManifest, ManifestError> {
    let json = json.strip_prefix('\u{feff}').unwrap_or(json);
    let value: serde_json::Value = serde_json::from_str(json).map_err(|e| {
        err(
            "invalid_json",
            format!("item manifest is not valid JSON: {e}"),
        )
    })?;
    parse_item_manifest_value(item_type, &value)
}

pub fn parse_item_manifest_value(
    item_type: &str,
    value: &serde_json::Value,
) -> Result<ItemManifest, ManifestError> {
    if item_type_folder(item_type).is_none() {
        return Err(err(
            "unknown_item_type",
            format!("unknown item type \"{item_type}\""),
        ));
    }
    if !value.is_object() {
        return Err(err(
            "invalid_item_json",
            "item manifest must be a JSON object",
        ));
    }

    let id = str_field(value, "id")
        .ok_or_else(|| err("missing_item_id", "item manifest is missing required id"))?;
    if !is_kebab_slug(&id) {
        return Err(err(
            "invalid_item_id",
            format!("id must be a kebab-case slug, got: {id}"),
        ));
    }

    let publisher_id = str_field(value, "publisherId").ok_or_else(|| {
        err(
            "missing_publisher_id",
            "item manifest is missing required publisherId",
        )
    })?;
    if !is_kebab_slug(&publisher_id) {
        return Err(err(
            "invalid_publisher_id",
            format!("publisherId must be a kebab-case slug, got: {publisher_id}"),
        ));
    }

    let version = str_field(value, "version").ok_or_else(|| {
        err(
            "missing_version",
            "item manifest is missing required version",
        )
    })?;
    if !is_semver(&version) {
        return Err(err(
            "invalid_version",
            format!("version must be semver, got: {version}"),
        ));
    }

    let name = str_field(value, "name").ok_or_else(|| {
        err(
            "invalid_field",
            "item manifest field \"name\" must be a non-empty string",
        )
    })?;

    let min_app_version = str_field(value, "minAppVersion");
    if let Some(min) = &min_app_version {
        if !is_semver(min) {
            return Err(err(
                "invalid_min_app_version",
                format!("minAppVersion must be semver when present, got: {min}"),
            ));
        }
    }

    let preview = str_field(value, "preview");
    if let Some(preview) = &preview {
        if let Err(message) = validate_preview_relpath(preview) {
            return Err(err(
                "invalid_field",
                format!("item manifest field \"preview\" {message}"),
            ));
        }
    }

    Ok(ItemManifest {
        item_type: item_type.to_string(),
        id,
        publisher_id,
        version,
        name,
        description: str_field(value, "description").unwrap_or_default(),
        author: str_field(value, "author").unwrap_or_default(),
        preview,
        min_app_version,
    })
}

/// Read an item's manifest from its root directory, detecting the type.
pub fn read_item_manifest(dir: &Path) -> Result<ItemManifest, String> {
    let item_type = detect_item_type(dir)?;
    let filename = item_manifest_filename(item_type).expect("detected type has a filename");
    let path = dir.join(filename);
    let contents =
        fs::read_to_string(&path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    parse_item_manifest_json(item_type, &contents)
        .map_err(|e| format!("invalid {filename} at {}: {e}", dir.display()))
}

/// Strict check for install / export: identity fields, declared preview file, and
/// the type-specific content validator.
pub fn validate_item_dir(dir: &Path) -> Result<ItemManifest, String> {
    let item = read_item_manifest(dir)?;
    let filename = item_manifest_filename(&item.item_type).expect("known type has a filename");
    let manifest_path = dir.join(filename);

    if let Some(preview) = &item.preview {
        validate_preview_file(dir, preview)?;
    }

    match item.item_type.as_str() {
        "theme" => validate_theme_contribution_at(&manifest_path),
        "skin" => validate_skin_contribution_at(&manifest_path),
        "visualizer" => validate_visualizer_contribution_at(&manifest_path),
        "sound" => validate_sound_contribution_at(&manifest_path),
        other => Err(format!("unknown item type \"{other}\"")),
    }
    .map_err(|e| format!("invalid {} \"{}\": {e}", item.item_type, item.id))?;

    Ok(item)
}

/// Item directories directly under `<zone root>/<type folder>/`, as `(type, dir)`.
/// Does not read manifests.
pub fn list_item_dirs(zone_root: &Path) -> Vec<(&'static str, PathBuf)> {
    let mut out = Vec::new();
    for &(folder, ty, _) in CONTRIBUTION_TYPE_FOLDERS {
        let Ok(entries) = fs::read_dir(zone_root.join(folder)) else {
            continue;
        };
        let mut dirs: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .filter(|p| {
                !p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with('.'))
            })
            .collect();
        dirs.sort();
        out.extend(dirs.into_iter().map(|d| (ty, d)));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("spk-format-item-{label}-{nanos}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn theme_json(extra: serde_json::Value) -> String {
        let mut value = serde_json::json!({
            "id": "midnight",
            "publisherId": "bryan",
            "version": "1.0.0",
            "name": "Midnight",
            "author": "Bryan",
            "description": "dark",
            "tokens": {
                "color-bg": "#000",
                "color-surface": "#111",
                "color-text-primary": "#fff",
                "color-text-secondary": "#aaa",
                "color-accent": "#7b8cde",
                "color-accent-muted": "#556",
                "color-border": "#222",
                "color-danger": "#e06c75",
                "font-ui": "system-ui"
            }
        });
        if let (Some(base), Some(extra)) = (value.as_object_mut(), extra.as_object()) {
            for (k, v) in extra {
                if v.is_null() {
                    base.remove(k);
                } else {
                    base.insert(k.clone(), v.clone());
                }
            }
        }
        value.to_string()
    }

    #[test]
    fn ids_and_dir_names() {
        assert_eq!(
            effective_item_id("bryan", "skin", "neon"),
            "bryan.skin.neon"
        );
        assert_eq!(item_dir_name("bryan", "neon"), "bryan.neon");
        assert_eq!(item_id_prefix("bryan", "skin"), "bryan.skin.");
        assert_eq!(item_type_folder("visualizer"), Some("visualizers"));
        assert_eq!(item_manifest_filename("visualizer"), Some("viz.json"));
        assert_eq!(item_type_for_manifest_filename("sound.json"), Some("sound"));
        assert_eq!(item_type_for_manifest_filename("pack.json"), None);
    }

    #[test]
    fn parses_full_manifest() {
        let item = parse_item_manifest_json(
            "theme",
            &theme_json(serde_json::json!({"minAppVersion": "0.2.0", "preview": "p.png"})),
        )
        .unwrap();
        assert_eq!(item.id, "midnight");
        assert_eq!(item.publisher_id, "bryan");
        assert_eq!(item.version, "1.0.0");
        assert_eq!(item.author, "Bryan");
        assert_eq!(item.min_app_version.as_deref(), Some("0.2.0"));
        assert_eq!(item.preview.as_deref(), Some("p.png"));
        assert_eq!(item.effective_id(), "bryan.theme.midnight");
        assert_eq!(item.dir_name(), "bryan.midnight");
    }

    #[test]
    fn requires_identity_fields() {
        for (field, code) in [
            ("id", "missing_item_id"),
            ("publisherId", "missing_publisher_id"),
            ("version", "missing_version"),
            ("name", "invalid_field"),
        ] {
            let json = theme_json(serde_json::json!({ field: null }));
            let e = parse_item_manifest_json("theme", &json).unwrap_err();
            assert_eq!(e.code, code, "removing {field}");
        }
    }

    #[test]
    fn rejects_bad_values() {
        let cases = [
            (serde_json::json!({"id": "Not Kebab"}), "invalid_item_id"),
            (
                serde_json::json!({"publisherId": "Bad_Author"}),
                "invalid_publisher_id",
            ),
            (serde_json::json!({"version": "one"}), "invalid_version"),
            (
                serde_json::json!({"minAppVersion": "x"}),
                "invalid_min_app_version",
            ),
            (serde_json::json!({"preview": "p.svg"}), "invalid_field"),
        ];
        for (extra, code) in cases {
            let e = parse_item_manifest_json("theme", &theme_json(extra)).unwrap_err();
            assert_eq!(e.code, code);
        }
        assert_eq!(
            parse_item_manifest_json("renderer", "{}").unwrap_err().code,
            "unknown_item_type"
        );
    }

    #[test]
    fn validate_item_dir_round_trip_and_type_detection() {
        let dir = temp_dir("ok");
        fs::write(dir.join("theme.json"), theme_json(serde_json::json!({}))).unwrap();
        assert_eq!(detect_item_type(&dir).unwrap(), "theme");
        let item = validate_item_dir(&dir).unwrap();
        assert_eq!(item.effective_id(), "bryan.theme.midnight");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_item_dir_rejects_missing_preview_file() {
        let dir = temp_dir("preview");
        fs::write(
            dir.join("theme.json"),
            theme_json(serde_json::json!({"preview": "p.png"})),
        )
        .unwrap();
        let e = validate_item_dir(&dir).unwrap_err();
        assert!(e.contains("preview not found"), "{e}");
        fs::write(dir.join("p.png"), b"x").unwrap();
        assert!(validate_item_dir(&dir).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_item_dir_runs_type_validator() {
        let dir = temp_dir("tokens");
        fs::write(
            dir.join("theme.json"),
            r#"{"id":"x","publisherId":"a","version":"1.0.0","name":"X","tokens":{}}"#,
        )
        .unwrap();
        let e = validate_item_dir(&dir).unwrap_err();
        assert!(e.contains("theme \"x\""), "{e}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detect_item_type_rejects_none_and_many() {
        let dir = temp_dir("detect");
        assert!(detect_item_type(&dir)
            .unwrap_err()
            .contains("no item manifest"));
        fs::write(dir.join("theme.json"), "{}").unwrap();
        fs::write(dir.join("sound.json"), "{}").unwrap();
        assert!(detect_item_type(&dir)
            .unwrap_err()
            .contains("more than one"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_item_dirs_walks_type_folders() {
        let root = temp_dir("list");
        fs::create_dir_all(root.join("themes/bryan.midnight")).unwrap();
        fs::create_dir_all(root.join("skins/bryan.neon")).unwrap();
        fs::create_dir_all(root.join("skins/.staging-x")).unwrap();
        fs::write(root.join("skins/stray.txt"), b"").unwrap();
        let found: Vec<_> = list_item_dirs(&root)
            .into_iter()
            .map(|(ty, d)| (ty, d.file_name().unwrap().to_string_lossy().into_owned()))
            .collect();
        assert_eq!(
            found,
            vec![
                ("theme", "bryan.midnight".to_string()),
                ("skin", "bryan.neon".to_string())
            ]
        );
        let _ = fs::remove_dir_all(&root);
    }
}
