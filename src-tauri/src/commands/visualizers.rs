use crate::activity_log::{self, LogLevel};
use crate::packs;
use crate::settings;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use tauri::AppHandle;

const SURFACE_DEFAULT: &str = "default";
const KNOWN_LAYER_KINDS: &[&str] = &["canvas", "webgl", "image", "video", "group"];
const IMAGE_EXTENSIONS: &[&str] = &["png", "webp", "gif"];
const VIDEO_EXTENSIONS: &[&str] = &["webm", "mp4"];

/// Contribution-relative media path shape (`assets/foo.webm`) before disk checks.
fn is_safe_media_asset_path(asset: &str) -> bool {
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
fn validate_media_asset(pack_dir: &Path, asset: &str, kind: &str, prefix: &str, errors: &mut Vec<String>) {
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
fn is_renderer_effective_id(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    parts.len() == 4
        && parts.iter().all(|p| packs::is_kebab_slug(p))
        && parts[2] == "renderer"
}

fn is_safe_pack_relative_js(path: &str) -> bool {
    !path.is_empty()
        && path.ends_with(".js")
        && !path.contains("..")
        && !path.starts_with('/')
        && !path.starts_with('\\')
        && !Path::new(path).is_absolute()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VizSummary {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub is_builtin: bool,
    pub pack_id: String,
    pub pack_name: String,
    pub pack_version: String,
    pub zone: packs::PackZone,
    pub preview_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedVisualizer {
    pub summary: VizSummary,
    pub pack_dir: String,
    pub manifest: VizManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VizManifest {
    pub name: String,
    pub author: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub surfaces: HashMap<String, VizSurfaceProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VizSurfaceProfile {
    pub scene: Vec<serde_json::Value>,
}

fn resolve_visualizer_id(stored: &str, known_ids: &HashSet<String>) -> String {
    if known_ids.contains(stored) {
        return stored.to_string();
    }
    if known_ids.contains(settings::DEFAULT_VISUALIZER_ID) {
        return settings::DEFAULT_VISUALIZER_ID.to_string();
    }
    known_ids
        .iter()
        .next()
        .cloned()
        .unwrap_or_else(|| settings::DEFAULT_VISUALIZER_ID.to_string())
}

fn normalize_surfaces(
    resolved: HashMap<String, VizSurfaceProfile>,
    prefix: &str,
) -> Result<HashMap<String, VizSurfaceProfile>, String> {
    for key in resolved.keys() {
        if key.as_str() != SURFACE_DEFAULT {
            return Err(format!(
                "{prefix}.{key} is not a known surface (default)"
            ));
        }
    }

    if !resolved.contains_key(SURFACE_DEFAULT) {
        return Err(format!("{prefix}.{SURFACE_DEFAULT} is required"));
    }

    Ok(resolved)
}

fn normalize_manifest(mut manifest: VizManifest) -> Result<VizManifest, String> {
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
            let renderer = layer
                .get("renderer")
                .and_then(|v| v.as_str())
                .unwrap_or("");
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
pub(crate) fn validate_visualizer_contribution_at(manifest_path: &Path) -> Result<(), String> {
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
    let manifest = normalize_manifest(parsed)?;
    validate_manifest(&manifest, pack_dir)
}

fn validate_manifest(manifest: &VizManifest, pack_dir: &Path) -> Result<(), String> {
    let mut errors = Vec::new();

    for (surface, profile) in &manifest.surfaces {
        validate_surface_profile(surface, profile, "surfaces", pack_dir, &mut errors);
    }

    if let Some(preview) = &manifest.preview {
        if preview.contains("..") || preview.starts_with('/') {
            errors.push(format!(
                "preview \"{preview}\" must be a relative path under the pack root"
            ));
        } else {
            let path = pack_dir.join(preview);
            if !path.is_file() {
                errors.push(format!("preview not found: {}", path.display()));
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

fn load_pack_from_contribution(
    contrib: &packs::ScannedContribution,
) -> Result<LoadedVisualizer, String> {
    let pack_dir = &contrib.contribution_dir;
    let manifest_path = &contrib.manifest_path;
    if !manifest_path.is_file() {
        return Err(format!(
            "visualizer \"{}\" is missing viz.json at {}",
            contrib.effective_id,
            manifest_path.display()
        ));
    }

    let contents = fs::read_to_string(manifest_path)
        .map_err(|e| format!("could not read {}: {e}", manifest_path.display()))?;
    let parsed: VizManifest = serde_json::from_str(&contents)
        .map_err(|e| format!("{} is not valid viz JSON: {e}", manifest_path.display()))?;

    let manifest = normalize_manifest(parsed)?;
    validate_manifest(&manifest, pack_dir)?;

    let preview_path = manifest
        .preview
        .as_ref()
        .map(|name| pack_dir.join(name))
        .filter(|p| p.is_file())
        .or_else(|| {
            ["preview.png", "preview.webp"]
                .iter()
                .map(|name| pack_dir.join(name))
                .find(|p| p.is_file())
        })
        .map(|p| p.to_string_lossy().into_owned());

    let summary = VizSummary {
        id: contrib.effective_id.clone(),
        name: manifest.name.clone(),
        author: manifest.author.clone(),
        description: manifest.description.clone(),
        is_builtin: contrib.zone.is_builtin(),
        pack_id: contrib.pack_id.clone(),
        pack_name: contrib.pack_name.clone(),
        pack_version: contrib.pack_version.clone(),
        zone: contrib.zone,
        preview_path,
    };

    Ok(LoadedVisualizer {
        summary,
        pack_dir: pack_dir.to_string_lossy().into_owned(),
        manifest,
    })
}

fn list_all_visualizer_packs(app: &AppHandle) -> Vec<LoadedVisualizer> {
    if let Err(e) = packs::ensure_packs_ready(app) {
        activity_log::log(
            LogLevel::Debug,
            "visualizer.load",
            format!("pack setup error: {e}"),
            None,
        );
    }

    let scan = packs::scan_contributions_of_type(app, "visualizer");
    for w in &scan.warnings {
        activity_log::log(LogLevel::Debug, "visualizer.load", w.message.clone(), None);
    }

    let hidden: HashSet<String> = settings::read_settings(app)
        .hidden_contribution_ids
        .into_iter()
        .collect();

    let mut packs = Vec::new();
    for contrib in &scan.contributions {
        if hidden.contains(&contrib.effective_id) {
            continue;
        }
        match load_pack_from_contribution(contrib) {
            Ok(pack) => packs.push(pack),
            Err(e) => {
                activity_log::log(
                    LogLevel::Debug,
                    "visualizer.load",
                    format!(
                        "visualizer \"{}\" failed to load: {e}",
                        contrib.effective_id
                    ),
                    Some(serde_json::json!({
                        "visualizerId": contrib.effective_id,
                        "builtin": contrib.zone.is_builtin(),
                        "error": e,
                    })),
                );
            }
        }
    }

    packs.sort_by(|a, b| a.summary.name.cmp(&b.summary.name));
    packs
}

#[tauri::command]
pub fn list_visualizers(app: AppHandle) -> Result<Vec<VizSummary>, String> {
    Ok(list_all_visualizer_packs(&app)
        .into_iter()
        .map(|p| p.summary)
        .collect())
}

#[tauri::command]
pub fn load_visualizer(
    app: AppHandle,
    visualizer_id: String,
) -> Result<LoadedVisualizer, String> {
    let packs = list_all_visualizer_packs(&app);
    let known: HashSet<String> = packs.iter().map(|p| p.summary.id.clone()).collect();
    let resolved = resolve_visualizer_id(&visualizer_id, &known);

    packs
        .into_iter()
        .find(|p| p.summary.id == resolved)
        .ok_or_else(|| {
            format!(
                "visualizer \"{visualizer_id}\" was not found in builtin, workshop, or installed packs"
            )
        })
}

#[tauri::command]
pub fn save_active_visualizer_id(app: AppHandle, visualizer_id: String) -> Result<(), String> {
    let mut app_settings = settings::read_settings(&app);
    app_settings.active_visualizer = visualizer_id;
    settings::write_settings(&app, &app_settings)
}

/// Read a VizRenderer contribution's entry JS by effective id (`authorId.packId.renderer.id`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VizRendererSource {
    pub source: String,
    pub engine: String,
}

#[tauri::command]
pub fn read_viz_renderer_source(
    app: AppHandle,
    renderer_id: String,
) -> Result<VizRendererSource, String> {
    if !is_renderer_effective_id(&renderer_id) {
        return Err(format!(
            "renderer id \"{renderer_id}\" must be authorId.packId.renderer.id"
        ));
    }

    let scan = packs::scan_contributions_of_type(&app, "renderer");
    let contrib = scan
        .contributions
        .iter()
        .find(|c| c.effective_id == renderer_id)
        .ok_or_else(|| format!("renderer \"{renderer_id}\" was not found"))?;

    let contents = fs::read_to_string(&contrib.manifest_path).map_err(|e| {
        format!(
            "could not read {}: {e}",
            contrib.manifest_path.display()
        )
    })?;
    let manifest: RendererManifestFile = serde_json::from_str(&contents).map_err(|e| {
        format!(
            "{} is not valid renderer JSON: {e}",
            contrib.manifest_path.display()
        )
    })?;

    if manifest.engine != "canvas2d" && manifest.engine != "webgl" {
        return Err(format!(
            "renderer \"{renderer_id}\" has unsupported engine \"{}\"",
            manifest.engine
        ));
    }

    if !is_safe_pack_relative_js(&manifest.entry) {
        return Err(format!(
            "renderer \"{renderer_id}\" has invalid entry path \"{}\"",
            manifest.entry
        ));
    }

    let entry_path = contrib.contribution_dir.join(&manifest.entry);
    let source = fs::read_to_string(&entry_path)
        .map_err(|e| format!("could not read {}: {e}", entry_path.display()))?;

    Ok(VizRendererSource {
        source,
        engine: manifest.engine,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RendererManifestFile {
    #[allow(dead_code)]
    id: String,
    engine: String,
    entry: String,
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
    let manifest: RendererManifestFile = serde_json::from_str(&contents)
        .map_err(|e| format!("{} is not valid renderer JSON: {e}", manifest_path.display()))?;

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

#[tauri::command]
pub fn get_active_visualizer_id(app: AppHandle) -> Result<String, String> {
    let mut app_settings = settings::read_settings(&app);
    let packs = list_all_visualizer_packs(&app);
    let known: HashSet<String> = packs.iter().map(|p| p.summary.id.clone()).collect();
    let resolved = resolve_visualizer_id(&app_settings.active_visualizer, &known);
    if resolved != app_settings.active_visualizer {
        app_settings.active_visualizer = resolved.clone();
        let _ = settings::write_settings(&app, &app_settings);
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_surface_is_kept() {
        let raw_json = r#"{
            "name": "Default Test",
            "author": "Spiral",
            "description": "Default surface only",
            "surfaces": {
                "default": {
                    "scene": [
                        { "kind": "canvas", "layout": "fill", "renderer": "spiral.core.renderer.bars", "params": { "barCount": 64 } }
                    ]
                }
            }
        }"#;
        let parsed: VizManifest =
            serde_json::from_str(raw_json).expect("manifest should parse");
        let manifest = normalize_manifest(parsed).expect("manifest should normalize");
        assert_eq!(
            manifest.surfaces["default"].scene[0]["params"]["barCount"].as_u64(),
            Some(64)
        );
        assert_eq!(manifest.surfaces.len(), 1);
    }

    #[test]
    fn unknown_surface_fails() {
        let raw_json = r#"{
            "name": "Bad Surface",
            "author": "Spiral",
            "description": "Unknown surface key",
            "surfaces": {
                "default": {
                    "scene": [
                        { "kind": "canvas", "layout": "fill", "renderer": "spiral.core.renderer.bars", "params": {} }
                    ]
                },
                "mini": {
                    "scene": [
                        { "kind": "canvas", "layout": "fill", "renderer": "spiral.core.renderer.bars", "params": {} }
                    ]
                }
            }
        }"#;
        let parsed: VizManifest =
            serde_json::from_str(raw_json).expect("manifest should parse");
        let err = normalize_manifest(parsed).expect_err("unknown surface should fail");
        assert!(err.contains("surfaces.mini is not a known surface"));
    }

    #[test]
    fn missing_default_surface_fails() {
        let raw_json = r#"{
            "name": "Bad Default",
            "author": "Spiral",
            "description": "Missing default surface",
            "surfaces": {}
        }"#;
        let parsed: VizManifest =
            serde_json::from_str(raw_json).expect("manifest should parse");
        let err = normalize_manifest(parsed).expect_err("missing default should fail");
        assert!(err.contains("surfaces.default is required"));
    }

    #[test]
    fn all_builtin_visualizers_load() {
        use crate::packs::scan::scan_zone_root;
        use crate::packs::PackZone;
        use std::path::PathBuf;

        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("packs/builtin");
        let mut warnings = Vec::new();
        let contribs = scan_zone_root(&root, PackZone::Builtin, &mut warnings);
        let mut loaded = 0usize;
        for contrib in contribs.iter().filter(|c| c.r#type == "visualizer") {
            load_pack_from_contribution(contrib)
                .unwrap_or_else(|e| panic!("{} should load: {e}", contrib.effective_id));
            loaded += 1;
        }
        assert_eq!(loaded, 4, "expected 4 built-in visualizer packs");
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
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let pack_dir = std::env::temp_dir().join(format!("spiral-viz-asset-{nanos}"));
        let assets = pack_dir.join("assets");
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join("bg.png"), b"png").unwrap();

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
            errors.iter().any(|e| e.contains("relative path under assets")),
            "{errors:?}"
        );

        let _ = fs::remove_dir_all(&pack_dir);
    }
}
