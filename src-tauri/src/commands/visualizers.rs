use crate::activity_log::{self, LogLevel};
use crate::settings;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const KNOWN_CANVAS_RENDERERS: &[&str] = &["bars", "wave", "spectrum"];
const KNOWN_WEBGL_RENDERERS: &[&str] = &["neon-tunnel"];
const SURFACE_DEFAULT: &str = "default";
const KNOWN_SURFACES: &[&str] = &["mini", "panel", "expanded"];
const AUTHORING_SURFACES: &[&str] = &["default", "mini", "panel", "expanded"];
const KNOWN_LAYER_KINDS: &[&str] = &["canvas", "webgl", "image", "gif", "video", "group"];
const ASSET_EXTENSIONS: &[&str] = &["png", "webp", "gif", "webm", "mp4"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VizSummary {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub is_builtin: bool,
    pub preview_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedVisualizerPack {
    pub summary: VizSummary,
    pub pack_dir: String,
    pub manifest: VizManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VizManifest {
    pub version: u32,
    pub name: String,
    pub author: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub surfaces: HashMap<String, VizSurfaceProfile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reduced_surfaces: Option<HashMap<String, VizSurfaceProfile>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VizManifestRaw {
    pub version: u32,
    pub name: String,
    pub author: String,
    pub description: String,
    #[serde(default)]
    pub preview: Option<String>,
    pub surfaces: HashMap<String, VizSurfaceProfile>,
    #[serde(default)]
    pub reduced_surfaces: Option<HashMap<String, VizSurfaceProfile>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VizSurfaceProfile {
    pub scene: Vec<serde_json::Value>,
}

fn builtin_visualizers_root(app: &AppHandle) -> PathBuf {
    let manifest_builtin =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("visualizers/builtin");

    #[cfg(debug_assertions)]
    if manifest_builtin.is_dir() {
        return manifest_builtin;
    }

    if let Ok(path) = app
        .path()
        .resolve("visualizers/builtin", BaseDirectory::Resource)
    {
        if path.is_dir() {
            return path;
        }
    }
    manifest_builtin
}

fn visualizers_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings::app_data_dir(app)?.join("visualizers"))
}

fn ensure_visualizers_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = visualizers_dir(app)?;
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("failed to create visualizers directory: {e}"))?;
    }
    Ok(dir)
}

fn pack_id_from_dir(dir: &Path) -> Option<String> {
    dir.file_name().and_then(|n| n.to_str()).map(str::to_string)
}

fn expand_surface_defaults(
    resolved: HashMap<String, VizSurfaceProfile>,
    prefix: &str,
    strip_default: bool,
) -> Result<HashMap<String, VizSurfaceProfile>, String> {
    for key in resolved.keys() {
        if !AUTHORING_SURFACES.contains(&key.as_str()) {
            return Err(format!(
                "{prefix}.{key} is not a known surface (default, mini, panel, expanded)"
            ));
        }
    }

    let default = resolved.get(SURFACE_DEFAULT).ok_or_else(|| {
        format!("{prefix}.{SURFACE_DEFAULT} is required")
    })?;
    let default_scene = default.scene.clone();

    let mut expanded = HashMap::new();
    for surface in KNOWN_SURFACES {
        let profile = resolved
            .get(*surface)
            .cloned()
            .unwrap_or_else(|| VizSurfaceProfile {
                scene: default_scene.clone(),
            });
        expanded.insert(surface.to_string(), profile);
    }

    if !strip_default {
        expanded.insert(
            SURFACE_DEFAULT.to_string(),
            VizSurfaceProfile {
                scene: default_scene,
            },
        );
    }

    Ok(expanded)
}

fn normalize_manifest(raw: VizManifestRaw) -> Result<VizManifest, String> {
    let surfaces = expand_surface_defaults(raw.surfaces, "surfaces", true)?;
    let reduced_surfaces = raw
        .reduced_surfaces
        .map(|entries| expand_surface_defaults(entries, "reducedSurfaces", false))
        .transpose()?;

    Ok(VizManifest {
        version: raw.version,
        name: raw.name,
        author: raw.author,
        description: raw.description,
        preview: raw.preview,
        surfaces,
        reduced_surfaces,
    })
}

fn validate_webgl_params(
    params: &HashMap<String, serde_json::Value>,
    prefix: &str,
    errors: &mut Vec<String>,
) {
    if let Some(ring_count) = params.get("ringCount") {
        if let Some(n) = ring_count.as_u64() {
            if !(12..=64).contains(&n) {
                errors.push(format!("{prefix}.params.ringCount must be between 12 and 64"));
            }
        }
    }
    if let Some(tunnel_speed) = params.get("tunnelSpeed") {
        if let Some(n) = tunnel_speed.as_f64() {
            if !(0.2..=3.0).contains(&n) {
                errors.push(format!("{prefix}.params.tunnelSpeed must be between 0.2 and 3"));
            }
        }
    }
    if let Some(glow) = params.get("glow") {
        if let Some(n) = glow.as_f64() {
            if !(0.0..=2.0).contains(&n) {
                errors.push(format!("{prefix}.params.glow must be between 0 and 2"));
            }
        }
    }
    if let Some(density) = params.get("particleDensity") {
        if let Some(n) = density.as_f64() {
            if !(0.0..=1.0).contains(&n) {
                errors.push(format!(
                    "{prefix}.params.particleDensity must be between 0 and 1"
                ));
            }
        }
    }
    if let Some(pulse) = params.get("bassPulse") {
        if let Some(n) = pulse.as_f64() {
            if !(0.0..=2.0).contains(&n) {
                errors.push(format!("{prefix}.params.bassPulse must be between 0 and 2"));
            }
        }
    }
}

fn validate_renderer_params(
    params: &HashMap<String, serde_json::Value>,
    prefix: &str,
    errors: &mut Vec<String>,
) {
    if let Some(bar_count) = params.get("barCount") {
        if let Some(n) = bar_count.as_u64() {
            if n == 0 || n > 256 {
                errors.push(format!("{prefix}.params.barCount must be between 1 and 256"));
            }
        }
    }
    if let Some(glow) = params.get("glow") {
        if let Some(n) = glow.as_f64() {
            if !(0.0..=2.0).contains(&n) {
                errors.push(format!("{prefix}.params.glow must be between 0 and 2"));
            }
        }
    }
}

fn asset_exists(pack_dir: &Path, asset_base: &str, kind: &str) -> bool {
    let preferred: &[&str] = match kind {
        "image" => &["png", "webp"],
        "gif" => &["gif"],
        "video" => &["webm", "mp4", "webp"],
        _ => ASSET_EXTENSIONS,
    };

    for ext in preferred {
        if pack_dir.join("assets").join(format!("{asset_base}.{ext}")).is_file() {
            return true;
        }
    }
    false
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
        "canvas" => {
            let renderer = layer
                .get("renderer")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !KNOWN_CANVAS_RENDERERS.contains(&renderer) {
                errors.push(format!(
                    "{prefix}.renderer \"{renderer}\" must be one of: {}",
                    KNOWN_CANVAS_RENDERERS.join(", ")
                ));
            }
            if let Some(params) = layer.get("params").and_then(|v| v.as_object()) {
                let map: HashMap<String, serde_json::Value> =
                    params.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
                validate_renderer_params(&map, prefix, errors);
            }
        }
        "webgl" => {
            let renderer = layer
                .get("renderer")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !KNOWN_WEBGL_RENDERERS.contains(&renderer) {
                errors.push(format!(
                    "{prefix}.renderer \"{renderer}\" must be one of: {}",
                    KNOWN_WEBGL_RENDERERS.join(", ")
                ));
            }
            if let Some(params) = layer.get("params").and_then(|v| v.as_object()) {
                let map: HashMap<String, serde_json::Value> =
                    params.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
                validate_webgl_params(&map, prefix, errors);
            }
        }
        "image" | "gif" | "video" => {
            let asset = match layer.get("asset").and_then(|v| v.as_str()) {
                Some(a) if !a.is_empty() => a,
                _ => {
                    errors.push(format!("{prefix}.asset is required for {kind} layers"));
                    return;
                }
            };
            if asset.contains("..") || asset.starts_with('/') {
                errors.push(format!(
                    "{prefix}.asset \"{asset}\" must be a relative path under assets/"
                ));
            } else if !asset_exists(pack_dir, asset, kind) {
                errors.push(format!(
                    "{prefix}.asset \"{asset}\" not found under {}",
                    pack_dir.join("assets").display()
                ));
            }
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

fn validate_manifest(manifest: &VizManifest, pack_dir: &Path) -> Result<(), String> {
    let mut errors = Vec::new();

    if manifest.version != 1 {
        errors.push(format!(
            "version must be 1 (got {})",
            manifest.version
        ));
    }

    for surface in KNOWN_SURFACES {
        if !manifest.surfaces.contains_key(*surface) {
            errors.push(format!("surfaces.{surface} is required"));
        }
    }

    for (surface, profile) in &manifest.surfaces {
        if !KNOWN_SURFACES.contains(&surface.as_str()) {
            errors.push(format!(
                "surfaces.{surface} is not a known surface (mini, panel, expanded)"
            ));
        }
        validate_surface_profile(surface, profile, "surfaces", pack_dir, &mut errors);
    }

    if let Some(reduced) = &manifest.reduced_surfaces {
        for (surface, profile) in reduced {
            if !AUTHORING_SURFACES.contains(&surface.as_str()) {
                errors.push(format!(
                    "reducedSurfaces.{surface} is not a known surface (default, mini, panel, expanded)"
                ));
            }
            validate_surface_profile(surface, profile, "reducedSurfaces", pack_dir, &mut errors);
        }
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

fn load_pack_from_dir(pack_dir: &Path, is_builtin: bool) -> Result<LoadedVisualizerPack, String> {
    let id = pack_id_from_dir(pack_dir)
        .ok_or_else(|| format!("invalid visualizer folder: {}", pack_dir.display()))?;
    let manifest_path = pack_dir.join("viz.json");
    if !manifest_path.is_file() {
        return Err(format!(
            "visualizer pack \"{id}\" is missing viz.json at {}",
            manifest_path.display()
        ));
    }

    let contents =
        fs::read_to_string(&manifest_path).map_err(|e| format!("could not read {}: {e}", manifest_path.display()))?;
    let raw: VizManifestRaw = serde_json::from_str(&contents)
        .map_err(|e| format!("{} is not valid viz JSON: {e}", manifest_path.display()))?;

    let manifest = normalize_manifest(raw)?;
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
        id: id.clone(),
        name: manifest.name.clone(),
        author: manifest.author.clone(),
        description: manifest.description.clone(),
        is_builtin,
        preview_path,
    };

    Ok(LoadedVisualizerPack {
        summary,
        pack_dir: pack_dir.to_string_lossy().into_owned(),
        manifest,
    })
}

fn list_builtin_packs(app: &AppHandle) -> Vec<LoadedVisualizerPack> {
    let root = builtin_visualizers_root(app);
    if !root.is_dir() {
        return vec![];
    }

    let mut packs = Vec::new();
    let entries = match fs::read_dir(&root) {
        Ok(e) => e,
        Err(e) => {
            activity_log::log(
                LogLevel::Debug,
                "visualizer.load",
                format!("builtin visualizers directory read error: {e}"),
                None,
            );
            return packs;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        match load_pack_from_dir(&path, true) {
            Ok(pack) => packs.push(pack),
            Err(e) => {
                let id = pack_id_from_dir(&path).unwrap_or_default();
                activity_log::log(
                    LogLevel::Debug,
                    "visualizer.load",
                    format!("built-in visualizer \"{id}\" failed to load: {e}"),
                    Some(serde_json::json!({
                        "visualizerId": id,
                        "builtin": true,
                        "error": e,
                    })),
                );
            }
        }
    }

    packs.sort_by(|a, b| a.summary.name.cmp(&b.summary.name));
    packs
}

fn list_user_packs(app: &AppHandle) -> Vec<LoadedVisualizerPack> {
    let dir = match visualizers_dir(app) {
        Ok(d) => d,
        Err(_) => return vec![],
    };
    if !dir.is_dir() {
        return vec![];
    }

    let mut packs = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) => {
            activity_log::log(
                LogLevel::Debug,
                "visualizer.load",
                format!("visualizers directory read error: {e}"),
                None,
            );
            return packs;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        match load_pack_from_dir(&path, false) {
            Ok(pack) => packs.push(pack),
            Err(e) => {
                let path_display = path.display().to_string();
                activity_log::log(
                    LogLevel::Debug,
                    "visualizer.load",
                    format!("user visualizer at {path_display} skipped: {e}"),
                    Some(serde_json::json!({
                        "path": path_display,
                        "builtin": false,
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
    let mut seen = HashSet::new();
    let mut summaries = Vec::new();

    for pack in list_builtin_packs(&app) {
        seen.insert(pack.summary.id.clone());
        summaries.push(pack.summary);
    }
    for pack in list_user_packs(&app) {
        if seen.insert(pack.summary.id.clone()) {
            summaries.push(pack.summary);
        }
    }

    Ok(summaries)
}

#[tauri::command]
pub fn load_visualizer_pack(app: AppHandle, pack_id: String) -> Result<LoadedVisualizerPack, String> {
    let builtin_dir = builtin_visualizers_root(&app).join(&pack_id);
    if builtin_dir.is_dir() {
        return load_pack_from_dir(&builtin_dir, true);
    }

    let user_dir = visualizers_dir(&app)?.join(&pack_id);
    if user_dir.is_dir() {
        return load_pack_from_dir(&user_dir, false);
    }

    Err(format!(
        "visualizer \"{pack_id}\" was not found in built-in or user visualizers folders"
    ))
}

#[tauri::command]
pub fn save_active_visualizer_id(app: AppHandle, pack_id: String) -> Result<(), String> {
    let mut app_settings = settings::read_settings(&app);
    app_settings.active_visualizer = pack_id;
    settings::write_settings(&app, &app_settings)
}

#[tauri::command]
pub fn get_active_visualizer_id(app: AppHandle) -> Result<String, String> {
    Ok(settings::read_settings(&app).active_visualizer)
}

#[tauri::command]
pub fn open_visualizers_folder(app: AppHandle) -> Result<(), String> {
    let dir = ensure_visualizers_dir(&app)?;
    app.opener()
        .open_path(dir.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| format!("failed to open visualizers folder: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_surface_fills_missing_overrides() {
        let raw_json = r#"{
            "version": 1,
            "name": "Default Test",
            "author": "Spiral",
            "description": "Default surface fallback",
            "surfaces": {
                "default": {
                    "scene": [
                        { "kind": "canvas", "layout": "fill", "renderer": "bars", "params": { "barCount": 64 } }
                    ]
                },
                "panel": {
                    "scene": [
                        { "kind": "canvas", "layout": "fill", "renderer": "bars", "params": { "barCount": 96 } }
                    ]
                }
            }
        }"#;
        let raw: VizManifestRaw = serde_json::from_str(raw_json).expect("raw manifest should parse");
        let manifest = normalize_manifest(raw).expect("manifest should normalize");
        assert_eq!(
            manifest.surfaces["mini"].scene[0]["params"]["barCount"].as_u64(),
            Some(64)
        );
        assert_eq!(
            manifest.surfaces["panel"].scene[0]["params"]["barCount"].as_u64(),
            Some(96)
        );
        assert_eq!(
            manifest.surfaces["expanded"].scene[0]["params"]["barCount"].as_u64(),
            Some(64)
        );
        assert!(!manifest.surfaces.contains_key("default"));
    }

    #[test]
    fn missing_default_surface_fails() {
        let raw_json = r#"{
            "version": 1,
            "name": "Bad Default",
            "author": "Spiral",
            "description": "Missing default surface",
            "surfaces": {
                "mini": { "scene": [{ "kind": "canvas", "layout": "fill", "renderer": "bars", "params": {} }] },
                "panel": { "scene": [{ "kind": "canvas", "layout": "fill", "renderer": "bars", "params": {} }] },
                "expanded": { "scene": [{ "kind": "canvas", "layout": "fill", "renderer": "bars", "params": {} }] }
            }
        }"#;
        let raw: VizManifestRaw = serde_json::from_str(raw_json).expect("raw manifest should parse");
        let err = normalize_manifest(raw).expect_err("missing default should fail");
        assert!(err.contains("surfaces.default is required"));
    }

    #[test]
    fn all_builtin_visualizers_load() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("visualizers/builtin");
        let entries = fs::read_dir(&root).expect("builtin visualizers directory should exist");
        let mut loaded = 0usize;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            load_pack_from_dir(&path, true).expect("builtin visualizer should load");
            loaded += 1;
        }
        assert!(loaded >= 4, "expected at least 4 built-in visualizer packs");
    }
}
