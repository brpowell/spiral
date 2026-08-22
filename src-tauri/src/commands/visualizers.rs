use crate::activity_log::{self, LogLevel};
use crate::packs;
use crate::settings;
use serde::{Deserialize, Serialize};
#[cfg(test)]
use spk_format::is_safe_media_asset_path;
use spk_format::{
    is_renderer_effective_id, is_safe_pack_relative_js, normalize_viz_manifest,
    resolve_preview_file, RendererManifestFile, VizManifest,
};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use tauri::AppHandle;

/// Strict visualizer contribution check used by pack install/export.
pub(crate) fn validate_visualizer_contribution_at(manifest_path: &Path) -> Result<(), String> {
    spk_format::validate_visualizer_contribution_at(manifest_path)
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

    let manifest = normalize_viz_manifest(parsed)?;
    validate_visualizer_contribution_at(manifest_path)?;

    let preview_path = resolve_preview_file(pack_dir, manifest.preview.as_deref())
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
pub fn load_visualizer(app: AppHandle, visualizer_id: String) -> Result<LoadedVisualizer, String> {
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

    let contents = fs::read_to_string(&contrib.manifest_path)
        .map_err(|e| format!("could not read {}: {e}", contrib.manifest_path.display()))?;
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
        let parsed: VizManifest = serde_json::from_str(raw_json).expect("manifest should parse");
        let manifest = normalize_viz_manifest(parsed).expect("manifest should normalize");
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
        let parsed: VizManifest = serde_json::from_str(raw_json).expect("manifest should parse");
        let err = normalize_viz_manifest(parsed).expect_err("unknown surface should fail");
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
        let parsed: VizManifest = serde_json::from_str(raw_json).expect("manifest should parse");
        let err = normalize_viz_manifest(parsed).expect_err("missing default should fail");
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
}
