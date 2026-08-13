//! Visualizer and renderer contribution validation.

use crate::is_kebab_slug;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const SURFACE_DEFAULT: &str = "default";
const KNOWN_LAYER_KINDS: &[&str] = &["canvas", "webgl", "image", "video", "group"];
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

/// Effective renderer id: `authorId.packId.renderer.contributionId`.
pub fn is_renderer_effective_id(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    parts.len() == 4 && parts.iter().all(|p| is_kebab_slug(p)) && parts[2] == "renderer"
}

pub fn is_safe_pack_relative_js(path: &str) -> bool {
    !path.is_empty()
        && path.ends_with(".js")
        && !path.contains("..")
        && !path.starts_with('/')
        && !path.starts_with('\\')
        && !Path::new(path).is_absolute()
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
    pub surfaces: HashMap<String, VizSurfaceProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VizSurfaceProfile {
    pub scene: Vec<serde_json::Value>,
}

pub fn normalize_surfaces(
    resolved: HashMap<String, VizSurfaceProfile>,
    prefix: &str,
) -> Result<HashMap<String, VizSurfaceProfile>, String> {
    for key in resolved.keys() {
        if key.as_str() != SURFACE_DEFAULT {
            return Err(format!("{prefix}.{key} is not a known surface (default)"));
        }
    }

    if !resolved.contains_key(SURFACE_DEFAULT) {
        return Err(format!("{prefix}.{SURFACE_DEFAULT} is required"));
    }

    Ok(resolved)
}

pub fn normalize_viz_manifest(mut manifest: VizManifest) -> Result<VizManifest, String> {
    manifest.surfaces = normalize_surfaces(manifest.surfaces, "surfaces")?;
    Ok(manifest)
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
            let renderer = layer.get("renderer").and_then(|v| v.as_str()).unwrap_or("");
            if !is_renderer_effective_id(renderer) {
                errors.push(format!(
                    "{prefix}.renderer \"{renderer}\" must be a fully-qualified renderer id (authorId.packId.renderer.id)"
                ));
            }
            if let Some(params) = layer.get("params") {
                if !params.is_object() {
                    errors.push(format!("{prefix}.params must be an object"));
                }
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
        "group" => {
            if let Some(children) = layer.get("children").and_then(|v| v.as_array()) {
                for (index, child) in children.iter().enumerate() {
                    validate_scene_layer(
                        child,
                        pack_dir,
                        &format!("{prefix}.children[{index}]"),
                        errors,
                    );
                }
            } else {
                errors.push(format!("{prefix}.children is required for group layers"));
            }
        }
        _ => {}
    }
}

fn validate_surface_profile(
    surface: &str,
    profile: &VizSurfaceProfile,
    prefix: &str,
    pack_dir: &Path,
    errors: &mut Vec<String>,
) {
    if profile.scene.is_empty() {
        errors.push(format!(
            "{prefix}.{surface}.scene must contain at least one layer"
        ));
        return;
    }

    for (index, layer) in profile.scene.iter().enumerate() {
        validate_scene_layer(
            layer,
            pack_dir,
            &format!("{prefix}.{surface}.scene[{index}]"),
            errors,
        );
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
    let parsed: VizManifest = serde_json::from_str(&contents)
        .map_err(|e| format!("{} is not valid viz JSON: {e}", manifest_path.display()))?;
    let manifest = normalize_viz_manifest(parsed)?;
    validate_manifest(&manifest, pack_dir)
}

fn validate_manifest(manifest: &VizManifest, pack_dir: &Path) -> Result<(), String> {
    let mut errors = Vec::new();

    for (surface, profile) in &manifest.surfaces {
        validate_surface_profile(surface, profile, "surfaces", pack_dir, &mut errors);
    }

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
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererManifestFile {
    #[allow(dead_code)]
    pub id: String,
    pub engine: String,
    pub entry: String,
}

/// Validate a renderer contribution at install / scan time.
pub fn validate_renderer_contribution_at(manifest_path: &Path) -> Result<(), String> {
    let contribution_dir = manifest_path.parent().ok_or_else(|| {
        format!(
            "renderer manifest has no parent directory: {}",
            manifest_path.display()
        )
    })?;
    let contents = fs::read_to_string(manifest_path)
        .map_err(|e| format!("could not read {}: {e}", manifest_path.display()))?;
    let manifest: RendererManifestFile = serde_json::from_str(&contents).map_err(|e| {
        format!(
            "{} is not valid renderer JSON: {e}",
            manifest_path.display()
        )
    })?;

    if manifest.engine != "canvas2d" && manifest.engine != "webgl" {
        return Err(format!(
            "{}: unsupported engine \"{}\" (expected canvas2d or webgl)",
            manifest_path.display(),
            manifest.engine
        ));
    }
    if !is_safe_pack_relative_js(&manifest.entry) {
        return Err(format!(
            "{}: entry \"{}\" must be a relative .js filename",
            manifest_path.display(),
            manifest.entry
        ));
    }
    let entry_path = contribution_dir.join(&manifest.entry);
    if !entry_path.is_file() {
        return Err(format!(
            "{}: entry file not found at {}",
            manifest_path.display(),
            entry_path.display()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn renderer_rejects_bad_engine() {
        let dir = std::env::temp_dir().join(format!("spk-renderer-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let entry = dir.join("main.js");
        std::fs::write(&entry, "export default {};").unwrap();
        let path = dir.join("renderer.json");
        std::fs::write(&path, r#"{"id":"bars","engine":"nope","entry":"main.js"}"#).unwrap();
        let err = validate_renderer_contribution_at(&path).unwrap_err();
        assert!(err.contains("unsupported engine"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn renderer_accepts_canvas2d() {
        let dir = std::env::temp_dir().join(format!("spk-renderer-ok-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("main.js"), "export default {};").unwrap();
        let path = dir.join("renderer.json");
        std::fs::write(
            &path,
            r#"{"id":"bars","engine":"canvas2d","entry":"main.js"}"#,
        )
        .unwrap();
        validate_renderer_contribution_at(&path).unwrap();
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
