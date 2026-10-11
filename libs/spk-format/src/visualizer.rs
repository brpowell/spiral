//! Visualizer contribution validation.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const KNOWN_LAYER_KINDS: &[&str] = &["canvas", "webgl", "image", "video"];
const IMAGE_EXTENSIONS: &[&str] = &["png", "webp", "gif"];
const VIDEO_EXTENSIONS: &[&str] = &["webm", "mp4"];

/// Contribution-relative media path shape (`assets/foo.webm`) before disk checks.
pub fn is_safe_media_asset_path(asset: &str) -> bool {
    if asset.is_empty() || asset.contains('\0') {
        return false;
    }
    if asset.starts_with('/') || asset.starts_with('\\') || Path::new(asset).is_absolute() {
        return false;
    }
    if asset.contains('\\') || asset.contains(':') {
        return false;
    }
    if !asset.starts_with("assets/") {
        return false;
    }
    let mut segments = asset.split('/');
    if segments.next() != Some("assets") {
        return false;
    }
    let mut saw_file = false;
    for segment in segments {
        if segment.is_empty() || segment == "." || segment == ".." {
            return false;
        }
        saw_file = true;
    }
    saw_file
}

/// `asset` is contribution-relative (`assets/foo.webm`), including prefix and extension.
fn validate_media_asset(
    pack_dir: &Path,
    asset: &str,
    kind: &str,
    prefix: &str,
    errors: &mut Vec<String>,
) {
    if !is_safe_media_asset_path(asset) {
        errors.push(format!(
            "{prefix}.asset \"{asset}\" must be a relative path under assets/ (no .., absolute, or drive paths)"
        ));
        return;
    }

    let allowed: &[&str] = match kind {
        "image" => IMAGE_EXTENSIONS,
        "video" => VIDEO_EXTENSIONS,
        _ => return,
    };
    let ext = Path::new(asset)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    if ext.is_empty() {
        errors.push(format!(
            "{prefix}.asset \"{asset}\" must include a file extension"
        ));
        return;
    }
    if !allowed.iter().any(|e| ext.eq_ignore_ascii_case(e)) {
        errors.push(format!(
            "{prefix}.asset \"{asset}\" extension .{ext} is not allowed for {kind} layers ({})",
            allowed
                .iter()
                .map(|e| format!(".{e}"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
        return;
    }

    let path = pack_dir.join(asset);
    if !path.is_file() {
        errors.push(format!(
            "{prefix}.asset \"{asset}\" not found at {}",
            path.display()
        ));
        return;
    }

    // Symlink / join containment: resolved file must stay under pack root.
    match (pack_dir.canonicalize(), path.canonicalize()) {
        (Ok(pack_canon), Ok(file_canon)) => {
            if !file_canon.starts_with(&pack_canon) {
                errors.push(format!(
                    "{prefix}.asset \"{asset}\" resolves outside the pack directory"
                ));
            }
        }
        _ => {
            errors.push(format!(
                "{prefix}.asset \"{asset}\" could not be resolved under the pack directory"
            ));
        }
    }
}

/// Safe relative JS entry under a visualizer contribution folder.
pub fn is_safe_pack_relative_js(path: &str) -> bool {
    !path.is_empty()
        && path.ends_with(".js")
        && !path.contains("..")
        && !path.contains('/')
        && !path.contains('\\')
        && !path.starts_with('/')
        && !Path::new(path).is_absolute()
}

fn validate_layer_entry(pack_dir: &Path, entry: &str, prefix: &str, errors: &mut Vec<String>) {
    if !is_safe_pack_relative_js(entry) {
        errors.push(format!(
            "{prefix}.entry \"{entry}\" must be a relative .js filename in the visualizer folder"
        ));
        return;
    }
    let entry_path = pack_dir.join(entry);
    if !entry_path.is_file() {
        errors.push(format!(
            "{prefix}.entry \"{entry}\" not found at {}",
            entry_path.display()
        ));
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VizManifest {
    pub name: String,
    pub author: String,
    pub description: String,
    /// Optional preview image path relative to the contribution directory.
    /// Raster only (`ALLOWED_PREVIEW_EXTENSIONS`); SVG is not permitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub children: Vec<serde_json::Value>,
}

fn validate_scene_layer(
    layer: &serde_json::Value,
    pack_dir: &Path,
    prefix: &str,
    errors: &mut Vec<String>,
) {
    let kind = match layer.get("kind").and_then(|v| v.as_str()) {
        Some(k) => k,
        None => {
            errors.push(format!("{prefix}.kind is required"));
            return;
        }
    };

    if !KNOWN_LAYER_KINDS.contains(&kind) {
        errors.push(format!(
            "{prefix}.kind \"{kind}\" must be one of: {}",
            KNOWN_LAYER_KINDS.join(", ")
        ));
        return;
    }

    if layer.get("layout").is_none() {
        errors.push(format!("{prefix}.layout is required"));
    }

    match kind {
        "canvas" | "webgl" => {
            let entry = layer.get("entry").and_then(|v| v.as_str()).unwrap_or("");
            if entry.is_empty() {
                errors.push(format!("{prefix}.entry is required for {kind} layers"));
            } else {
                validate_layer_entry(pack_dir, entry, prefix, errors);
            }
        }
        "image" | "video" => {
            let asset = match layer.get("asset").and_then(|v| v.as_str()) {
                Some(a) if !a.is_empty() => a,
                _ => {
                    errors.push(format!("{prefix}.asset is required for {kind} layers"));
                    return;
                }
            };
            validate_media_asset(pack_dir, asset, kind, prefix, errors);
        }
        _ => {}
    }
}

fn validate_children(children: &[serde_json::Value], pack_dir: &Path, errors: &mut Vec<String>) {
    if children.is_empty() {
        errors.push("children must contain at least one layer".to_string());
        return;
    }

    for (index, layer) in children.iter().enumerate() {
        validate_scene_layer(layer, pack_dir, &format!("children[{index}]"), errors);
    }
}

/// Strict visualizer contribution check used by pack install/export.
pub fn validate_visualizer_contribution_at(manifest_path: &Path) -> Result<(), String> {
    let pack_dir = manifest_path.parent().ok_or_else(|| {
        format!(
            "visualizer manifest has no parent directory: {}",
            manifest_path.display()
        )
    })?;
    let contents = fs::read_to_string(manifest_path)
        .map_err(|e| format!("could not read {}: {e}", manifest_path.display()))?;
    let manifest: VizManifest = serde_json::from_str(&contents)
        .map_err(|e| format!("{} is not valid viz JSON: {e}", manifest_path.display()))?;
    validate_manifest(&manifest, pack_dir)
}

fn validate_manifest(manifest: &VizManifest, pack_dir: &Path) -> Result<(), String> {
    let mut errors = Vec::new();

    validate_children(&manifest.children, pack_dir, &mut errors);

    if let Some(preview) = &manifest.preview {
        if let Err(message) = crate::validate_preview_file(pack_dir, preview) {
            errors.push(message);
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canvas_layer_requires_entry_file() {
        let dir = std::env::temp_dir().join(format!("spk-viz-entry-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.js"), "export function create() {}").unwrap();
        let path = dir.join("viz.json");
        std::fs::write(
            &path,
            r#"{
              "id": "bars",
              "name": "Bars",
              "author": "Spiral",
              "description": "test",
              "children": [
                { "kind": "canvas", "layout": "fill", "entry": "index.js" }
              ]
            }"#,
        )
        .unwrap();
        validate_visualizer_contribution_at(&path).unwrap();

        std::fs::write(
            &path,
            r#"{
              "id": "bars",
              "name": "Bars",
              "author": "Spiral",
              "description": "test",
              "children": [
                { "kind": "canvas", "layout": "fill", "entry": "missing.js" }
              ]
            }"#,
        )
        .unwrap();
        let err = validate_visualizer_contribution_at(&path).unwrap_err();
        assert!(err.contains("not found"), "{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn canvas_layer_rejects_path_traversal_entry() {
        let dir = std::env::temp_dir().join(format!("spk-viz-bad-entry-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("viz.json");
        std::fs::write(
            &path,
            r#"{
              "id": "bars",
              "name": "Bars",
              "author": "Spiral",
              "description": "test",
              "children": [
                { "kind": "canvas", "layout": "fill", "entry": "../secret.js" }
              ]
            }"#,
        )
        .unwrap();
        let err = validate_visualizer_contribution_at(&path).unwrap_err();
        assert!(err.contains("relative .js filename"), "{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_children_fails() {
        let dir = std::env::temp_dir().join(format!("spk-viz-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("viz.json");
        std::fs::write(
            &path,
            r#"{
              "id": "bars",
              "name": "Bars",
              "author": "Spiral",
              "description": "test",
              "children": []
            }"#,
        )
        .unwrap();
        let err = validate_visualizer_contribution_at(&path).unwrap_err();
        assert!(
            err.contains("children must contain at least one layer"),
            "{err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn safe_media_asset_path_rejects_traversal() {
        assert!(is_safe_media_asset_path("assets/bg.png"));
        assert!(is_safe_media_asset_path("assets/clips/ambient.webm"));
        assert!(!is_safe_media_asset_path("assets/../secret.png"));
        assert!(!is_safe_media_asset_path("/etc/passwd"));
        assert!(!is_safe_media_asset_path("assets/foo\\bar.png"));
        assert!(!is_safe_media_asset_path("C:/Music/x.png"));
        assert!(!is_safe_media_asset_path("bg.png"));
        assert!(!is_safe_media_asset_path("assets//bg.png"));
    }

    #[test]
    fn validate_media_asset_accepts_pack_file_and_rejects_escape() {
        let pack_dir = std::env::temp_dir().join(format!("spk-viz-asset-{}", std::process::id()));
        let assets = pack_dir.join("assets");
        std::fs::create_dir_all(&assets).unwrap();
        std::fs::write(assets.join("bg.png"), b"png").unwrap();

        let mut errors = Vec::new();
        validate_media_asset(&pack_dir, "assets/bg.png", "image", "layer", &mut errors);
        assert!(errors.is_empty(), "{errors:?}");

        errors.clear();
        validate_media_asset(
            &pack_dir,
            "assets/../assets/bg.png",
            "image",
            "layer",
            &mut errors,
        );
        assert!(
            errors
                .iter()
                .any(|e| e.contains("relative path under assets")),
            "{errors:?}"
        );

        let _ = std::fs::remove_dir_all(&pack_dir);
    }
}
