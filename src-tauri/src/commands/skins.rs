use crate::activity_log::{self, LogLevel};
use crate::packs;
use crate::settings;
use serde::{Deserialize, Serialize};
use spk_format::{read_skin_manifest, resolve_preview_file, validate_skin_manifest, SkinManifest};
#[cfg(test)]
use spk_format::{ControlFields, LayoutNode, ViewLayout};
use std::collections::HashSet;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinSummary {
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
pub struct LoadedSkinPack {
    pub summary: SkinSummary,
    pub pack_dir: String,
    pub manifest: SkinManifest,
}

fn resolve_skin_id(stored: &str, known_ids: &HashSet<String>) -> String {
    if known_ids.contains(stored) {
        return stored.to_string();
    }
    if known_ids.contains(settings::DEFAULT_SKIN_ID) {
        return settings::DEFAULT_SKIN_ID.to_string();
    }
    known_ids
        .iter()
        .next()
        .cloned()
        .unwrap_or_else(|| settings::DEFAULT_SKIN_ID.to_string())
}

fn load_pack_from_contribution(
    contrib: &packs::ScannedContribution,
) -> Result<LoadedSkinPack, String> {
    let pack_dir = &contrib.contribution_dir;
    let manifest_path = &contrib.manifest_path;
    if !manifest_path.is_file() {
        return Err(format!(
            "skin \"{}\" is missing skin.json at {}",
            contrib.effective_id,
            manifest_path.display()
        ));
    }

    let manifest = read_skin_manifest(manifest_path)?;
    validate_skin_manifest(&manifest, pack_dir)?;

    let preview_path = resolve_preview_file(pack_dir, manifest.preview.as_deref())
        .map(|p| p.to_string_lossy().into_owned());

    let summary = SkinSummary {
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

    Ok(LoadedSkinPack {
        summary,
        pack_dir: pack_dir.to_string_lossy().into_owned(),
        manifest,
    })
}

fn list_all_skin_packs(app: &AppHandle) -> Vec<LoadedSkinPack> {
    if let Err(e) = packs::ensure_packs_ready(app) {
        activity_log::log(
            LogLevel::Debug,
            "skin.load",
            format!("pack setup error: {e}"),
            None,
        );
    }

    let scan = packs::scan_contributions_of_type(app, "skin");
    for w in &scan.warnings {
        activity_log::log(LogLevel::Debug, "skin.load", w.message.clone(), None);
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
                    LogLevel::Error,
                    "skin.load",
                    format!("skin \"{}\" failed to load: {e}", contrib.effective_id),
                    Some(serde_json::json!({
                        "skinId": contrib.effective_id,
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
pub fn list_skins(app: AppHandle) -> Result<Vec<SkinSummary>, String> {
    Ok(list_all_skin_packs(&app)
        .into_iter()
        .map(|p| p.summary)
        .collect())
}

#[tauri::command]
pub fn load_skin_pack(app: AppHandle, skin_id: String) -> Result<LoadedSkinPack, String> {
    let packs = list_all_skin_packs(&app);
    let known: HashSet<String> = packs.iter().map(|p| p.summary.id.clone()).collect();
    let resolved = resolve_skin_id(&skin_id, &known);

    packs
        .into_iter()
        .find(|p| p.summary.id == resolved)
        .ok_or_else(|| {
            format!("skin \"{skin_id}\" was not found in builtin, workshop, or installed packs")
        })
}

#[tauri::command]
pub fn save_active_skin_id(app: AppHandle, skin_id: String) -> Result<(), String> {
    let mut app_settings = settings::read_settings(&app);
    app_settings.active_skin = skin_id;
    settings::write_settings(&app, &app_settings)
}

#[tauri::command]
pub fn get_active_skin_id(app: AppHandle) -> Result<String, String> {
    let mut app_settings = settings::read_settings(&app);
    let packs = list_all_skin_packs(&app);
    let known: HashSet<String> = packs.iter().map(|p| p.summary.id.clone()).collect();
    let resolved = resolve_skin_id(&app_settings.active_skin, &known);
    if resolved != app_settings.active_skin {
        app_settings.active_skin = resolved.clone();
        let _ = settings::write_settings(&app, &app_settings);
    }
    Ok(resolved)
}

#[tauri::command]
pub fn save_active_skin_view(app: AppHandle, view_id: String) -> Result<(), String> {
    let mut app_settings = settings::read_settings(&app);
    app_settings.active_skin_view = view_id;
    settings::write_settings(&app, &app_settings)
}

#[tauri::command]
pub fn get_active_skin_view(app: AppHandle) -> Result<String, String> {
    Ok(settings::read_settings(&app).active_skin_view)
}

/// Enable or disable OS click-through for the calling skin window.
#[tauri::command]
pub fn set_skin_ignore_cursor_events(
    window: tauri::WebviewWindow,
    ignore: bool,
) -> Result<(), String> {
    crate::skin_click_through::set_ignore_cursor_events(&window, ignore)
}

/// Begin dragging a skin window from a skin drag region.
#[tauri::command]
pub fn start_skin_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    crate::skin_drag::start_drag(&window)
}

/// OS cursor in CSS client coordinates of the calling skin window.
#[tauri::command]
pub fn get_skin_cursor_client_position(
    window: tauri::WebviewWindow,
) -> Result<crate::skin_click_through::ClientPoint, String> {
    crate::skin_click_through::cursor_client_point(&window)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packs::scan::scan_zone_root;
    use crate::packs::PackZone;
    use std::path::PathBuf;

    #[test]
    fn all_builtin_skins_load() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("packs/builtin");
        let mut warnings = Vec::new();
        let contribs = scan_zone_root(&root, PackZone::Builtin, &mut warnings);
        let mut loaded = 0usize;
        for contrib in contribs.iter().filter(|c| c.r#type == "skin") {
            load_pack_from_contribution(contrib).unwrap_or_else(|e| {
                panic!("built-in skin {} should load: {e}", contrib.effective_id)
            });
            loaded += 1;
        }
        assert_eq!(loaded, 1, "expected 1 built-in skin in core");
        assert!(
            contribs
                .iter()
                .any(|c| c.effective_id == "spiral.core.skin.vanilla"),
            "spiral.core.skin.vanilla should be present"
        );
    }

    #[test]
    fn mini_switch_fixture_preserves_view_id() {
        let pack_dir =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../testdata/packs/mini-switch");
        let mut warnings = Vec::new();
        let contribs =
            crate::packs::scan::scan_pack_dir(&pack_dir, PackZone::Builtin, &mut warnings);
        let skin = contribs
            .iter()
            .find(|c| c.effective_id == "spiral.fixture-mini-switch.skin.mini-switch")
            .unwrap_or_else(|| {
                panic!(
                    "spiral.fixture-mini-switch.skin.mini-switch; warnings={:?} ids={:?}",
                    warnings,
                    contribs.iter().map(|c| &c.effective_id).collect::<Vec<_>>()
                )
            });
        let pack = load_pack_from_contribution(skin).expect("fixture skin should load");
        let main = &pack.manifest.views["main"];
        let mini_switch = find_control_by_id(&main.layout, "mini-switch")
            .expect("main view should include mini-switch button");
        assert_eq!(
            mini_switch
                .on_click
                .as_ref()
                .and_then(|effects| effects.first())
                .and_then(|effect| effect.payload.as_ref())
                .and_then(|payload| payload.get("viewId"))
                .and_then(|value| value.as_str()),
            Some("mini")
        );
    }

    fn find_control_by_id<'a>(layout: &'a ViewLayout, id: &str) -> Option<&'a ControlFields> {
        let children = match layout {
            ViewLayout::Canvas(f) => &f.children,
            ViewLayout::Row(f) | ViewLayout::Column(f) => &f.children,
        };
        children
            .iter()
            .find_map(|child| find_control_in_node(child, id))
    }

    fn find_control_in_node<'a>(node: &'a LayoutNode, id: &str) -> Option<&'a ControlFields> {
        match node {
            LayoutNode::Button(f)
            | LayoutNode::Artwork(f)
            | LayoutNode::Transport(f)
            | LayoutNode::Visualizer(f)
            | LayoutNode::Rating(f)
            | LayoutNode::Time(f)
                if f.id.as_deref() == Some(id) =>
            {
                Some(f)
            }
            LayoutNode::Slider(f) if f.base.id.as_deref() == Some(id) => Some(&f.base),
            LayoutNode::Row(f) | LayoutNode::Column(f) | LayoutNode::Overlay(f) => f
                .children
                .iter()
                .find_map(|child| find_control_in_node(child, id)),
            LayoutNode::Subview(f) => f
                .children
                .iter()
                .find_map(|child| find_control_in_node(child, id)),
            LayoutNode::TiledFrame(f) => f
                .children
                .iter()
                .find_map(|child| find_control_in_node(child, id)),
            _ => None,
        }
    }
}
