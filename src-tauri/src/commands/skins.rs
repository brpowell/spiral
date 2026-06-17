use crate::settings;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const KNOWN_ACTIONS: &[&str] = &[
    "player.togglePlayPause",
    "player.previousTrack",
    "player.nextTrack",
    "player.cycleRepeat",
    "player.toggleShuffle",
    "player.seek",
    "player.setVolume",
    "player.toggleMute",
    "player.clearTrackList",
    "navigation.openAlbum",
    "queue.openTrackList",
    "skin.openPicker",
    "skin.exit",
    "skin.minimize",
    "skin.toggleAlwaysOnTop",
    "skin.restoreMainWindow",
    "app.quit",
];

const KNOWN_BINDS: &[&str] = &[
    "track.title",
    "track.artist",
    "track.metadataLine",
    "track.album",
    "track.artUrl",
    "track.durationSeconds",
    "player.isPlaying",
    "player.notPlaying",
    "player.playbackState",
    "player.positionSeconds",
    "player.repeatMode",
    "player.shuffle",
    "player.volume",
    "player.muted",
    "player.canGoPrevious",
    "player.canGoNext",
    "queue.length",
    "player.hasTrack",
    "skin.alwaysOnTop",
    "playback.source",
];

const SHELL_SLOTS: &[&str] = &["header", "art", "info", "controls", "visualizer", "footer"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinSummary {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub is_builtin: bool,
    pub preview_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSkinPack {
    pub summary: SkinSummary,
    pub pack_dir: String,
    pub manifest: SkinManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinManifest {
    pub version: u32,
    pub name: String,
    pub author: String,
    pub description: String,
    pub default_view: String,
    pub views: HashMap<String, SkinView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_styles: Option<HashMap<String, TextStyle>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<WindowChrome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visualizer: Option<SkinVisualizer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animations: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timelines: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stylesheet: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinView {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvas: Option<SkinCanvasSpec>,
    pub layout: LayoutNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinCanvasSpec {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutBounds {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z_index: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LayoutNode {
    #[serde(rename = "stack")]
    Stack(ContainerFields),
    #[serde(rename = "row")]
    Row(ContainerFields),
    #[serde(rename = "column")]
    Column(ContainerFields),
    #[serde(rename = "overlay")]
    Overlay(ContainerFields),
    #[serde(rename = "canvas")]
    Canvas(ContainerFields),
    #[serde(rename = "region")]
    Region(RegionFields),
    #[serde(rename = "decoration")]
    Decoration(DecorationFields),
    #[serde(rename = "button")]
    Button(ControlFields),
    #[serde(rename = "buttonGroup")]
    ButtonGroup(ButtonGroupFields),
    #[serde(rename = "seekbar")]
    Seekbar(ControlFields),
    #[serde(rename = "text")]
    Text(TextControlFields),
    #[serde(rename = "artwork")]
    Artwork(ControlFields),
    #[serde(rename = "transport")]
    Transport(ControlFields),
    #[serde(rename = "visualizer")]
    Visualizer(ControlFields),
    #[serde(rename = "volume")]
    Volume(ControlFields),
    #[serde(rename = "queue")]
    Queue(ControlFields),
    #[serde(rename = "time")]
    Time(ControlFields),
    #[serde(rename = "dragRegion")]
    DragRegion(DragRegionFields),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub children: Vec<LayoutNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z_index: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag_region: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub slot: String,
    pub children: Vec<LayoutNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag_region: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecorationFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub presentation: Presentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag_region: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragRegionFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub bounds: LayoutBounds,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonGroupElement {
    pub mapping_color: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonGroupFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub presentation: Presentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled_when: Option<String>,
    pub presentation: Presentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextControlFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_style: Option<String>,
    pub presentation: Presentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Presentation {
    #[serde(rename = "bitmap", rename_all = "camelCase")]
    Bitmap {
        asset_base: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        width: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        height: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        animated_hover: Option<bool>,
    },
    #[serde(rename = "gif", rename_all = "camelCase")]
    Gif { asset_base: String },
    #[serde(rename = "primitive", rename_all = "camelCase")]
    Primitive {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        class_prefix: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        variant: Option<String>,
    },
    #[serde(rename = "css", rename_all = "camelCase")]
    Css {
        class_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stylesheet: Option<String>,
    },
    #[serde(rename = "stripSlider", rename_all = "camelCase")]
    StripSlider {
        strip: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        position_map: Option<String>,
        frame_width: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        frame_height: Option<f64>,
        frame_count: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        direction: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        invert: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        class_prefix: Option<String>,
    },
    #[serde(rename = "digitStrip", rename_all = "camelCase")]
    DigitStrip {
        strip: String,
        frame_width: f64,
        frame_height: f64,
        slots: Vec<DigitStripSlot>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sign_frame_elapsed: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sign_frame_remaining: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        class_prefix: Option<String>,
    },
    #[serde(rename = "buttonGroup", rename_all = "camelCase")]
    ButtonGroup {
        asset_base: String,
        position_map: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        width: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        height: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        animated_hover: Option<bool>,
        elements: Vec<ButtonGroupElement>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DigitStripSlot {
    pub role: String,
    pub x: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncate: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scroll: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowChrome {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip_mask: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resizable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snap_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinVisualizer {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pack: Option<String>,
    /// Legacy preset name — maps to built-in pack ids at runtime.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placement: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<SkinVisualizerSize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinVisualizerSize {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<SkinVisualizerDimension>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<SkinVisualizerDimension>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SkinVisualizerDimension {
    Keyword(String),
    Pixels(u32),
}

fn builtin_skins_root(app: &AppHandle) -> PathBuf {
    let manifest_builtin =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("skins/builtin");

    // Dev builds bundle resources at compile time; prefer live source so new assets
    // under skins/builtin/ are picked up without a full rebuild.
    #[cfg(debug_assertions)]
    if manifest_builtin.is_dir() {
        return manifest_builtin;
    }

    if let Ok(path) = app.path().resolve("skins/builtin", BaseDirectory::Resource) {
        if path.is_dir() {
            return path;
        }
    }
    manifest_builtin
}

fn skins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings::app_data_dir(app)?.join("skins"))
}

fn ensure_skins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = skins_dir(app)?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("failed to create skins directory: {e}"))?;
    }
    Ok(dir)
}

fn skin_id_from_dir(dir: &Path) -> Option<String> {
    dir.file_name().and_then(|n| n.to_str()).map(str::to_string)
}

fn read_manifest(path: &Path) -> Result<SkinManifest, String> {
    let contents =
        fs::read_to_string(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("{} is not valid skin JSON: {e}", path.display()))
}

fn validate_bind(path: Option<&str>, field: &str, errors: &mut Vec<String>) {
    if let Some(p) = path {
        if !KNOWN_BINDS.contains(&p) {
            errors.push(format!(
                "{field} references unknown bind path \"{p}\". See skin-contract.md for valid paths."
            ));
        }
    }
}

fn validate_action(action: Option<&str>, errors: &mut Vec<String>) {
    if let Some(a) = action {
        if !KNOWN_ACTIONS.contains(&a) {
            errors.push(format!(
                "control action \"{a}\" is not in the Spiral action catalog."
            ));
        }
    }
}

fn validate_presentation(
    presentation: &Presentation,
    pack_dir: &Path,
    errors: &mut Vec<String>,
) {
    match presentation {
        Presentation::Bitmap {
            asset_base,
            animated_hover,
            ..
        } => {
            if asset_base.contains("..") || asset_base.starts_with('/') {
                errors.push(format!(
                    "bitmap assetBase \"{asset_base}\" must be a relative path under assets/"
                ));
                return;
            }
            let base = pack_dir.join("assets").join(asset_base);
            let has_default = ["png", "webp", "jpg", "jpeg"]
                .iter()
                .any(|ext| base.with_extension(ext).is_file());
            if !has_default {
                errors.push(format!(
                    "bitmap asset not found: expected {}.(png|webp|jpg)",
                    base.display()
                ));
            }
            if animated_hover.unwrap_or(false) {
                let hover_path = pack_dir
                    .join("assets")
                    .join(format!("{asset_base}-hover.gif"));
                if !hover_path.is_file() {
                    errors.push(format!(
                        "bitmap animatedHover: expected {}",
                        hover_path.display()
                    ));
                }
            }
        }
        Presentation::Gif { asset_base, .. } => {
            if asset_base.contains("..") || asset_base.starts_with('/') {
                errors.push(format!(
                    "gif assetBase \"{asset_base}\" must be a relative path under assets/"
                ));
                return;
            }
            let path = pack_dir.join("assets").join(asset_base).with_extension("gif");
            if !path.is_file() {
                errors.push(format!(
                    "gif asset not found: expected {}",
                    path.display()
                ));
            }
        }
        Presentation::Css { stylesheet, .. } => {
            if let Some(sheet) = stylesheet {
                let path = pack_dir.join(sheet);
                if !path.is_file() {
                    errors.push(format!(
                        "CSS stylesheet not found: {}",
                        path.display()
                    ));
                }
            }
        }
        Presentation::Primitive { .. } => {}
        Presentation::StripSlider {
            strip,
            position_map,
            frame_width,
            frame_count,
            ..
        } => {
            for (label, path) in [("strip", strip.as_str())]
                .into_iter()
                .chain(position_map.as_deref().map(|p| ("positionMap", p)))
            {
                if path.contains("..") || path.starts_with('/') {
                    errors.push(format!(
                        "stripSlider {label} \"{path}\" must be a relative path under assets/"
                    ));
                    return;
                }
                let base = pack_dir.join("assets").join(path);
                let found = ["png", "webp", "jpg", "jpeg"]
                    .iter()
                    .any(|ext| base.with_extension(ext).is_file());
                if !found {
                    errors.push(format!(
                        "stripSlider {label} asset not found: expected {}.(png|webp|jpg)",
                        base.display()
                    ));
                }
            }
            if *frame_width <= 0.0 {
                errors.push("stripSlider frameWidth must be positive".into());
            }
            if *frame_count < 2 {
                errors.push("stripSlider frameCount must be at least 2".into());
            }
        }
        Presentation::DigitStrip {
            strip,
            frame_width,
            frame_height,
            slots,
            ..
        } => {
            if strip.contains("..") || strip.starts_with('/') {
                errors.push(format!(
                    "digitStrip strip \"{strip}\" must be a relative path under assets/"
                ));
                return;
            }
            let base = pack_dir.join("assets").join(strip);
            let found = ["png", "webp", "jpg", "jpeg"]
                .iter()
                .any(|ext| base.with_extension(ext).is_file());
            if !found {
                errors.push(format!(
                    "digitStrip strip asset not found: expected {}.(png|webp|jpg)",
                    base.display()
                ));
            }
            if *frame_width <= 0.0 {
                errors.push("digitStrip frameWidth must be positive".into());
            }
            if *frame_height <= 0.0 {
                errors.push("digitStrip frameHeight must be positive".into());
            }
            if slots.is_empty() {
                errors.push("digitStrip slots must not be empty".into());
            }
            const VALID_ROLES: &[&str] = &[
                "sign",
                "minuteTens",
                "minuteOnes",
                "secondTens",
                "secondOnes",
            ];
            for slot in slots {
                if !VALID_ROLES.contains(&slot.role.as_str()) {
                    errors.push(format!(
                        "digitStrip slot role \"{}\" must be one of: {}",
                        slot.role,
                        VALID_ROLES.join(", ")
                    ));
                }
            }
        }
        Presentation::ButtonGroup {
            asset_base,
            position_map,
            animated_hover,
            elements,
            ..
        } => {
            for (label, path) in [("assetBase", asset_base.as_str()), ("positionMap", position_map.as_str())]
            {
                if path.contains("..") || path.starts_with('/') {
                    errors.push(format!(
                        "buttonGroup {label} \"{path}\" must be a relative path under assets/"
                    ));
                    return;
                }
                let base = pack_dir.join("assets").join(path);
                let found = ["png", "webp", "jpg", "jpeg"]
                    .iter()
                    .any(|ext| base.with_extension(ext).is_file());
                if !found {
                    errors.push(format!(
                        "buttonGroup {label} asset not found: expected {}.(png|webp|jpg)",
                        base.display()
                    ));
                }
            }
            if animated_hover.unwrap_or(false) {
                let hover_path = pack_dir
                    .join("assets")
                    .join(format!("{asset_base}-hover.gif"));
                if !hover_path.is_file() {
                    errors.push(format!(
                        "buttonGroup animatedHover: expected {}",
                        hover_path.display()
                    ));
                }
            }
            if elements.is_empty() {
                errors.push("buttonGroup elements must not be empty".into());
            }
            for element in elements {
                validate_action(Some(element.action.as_str()), errors);
            }
        }
    }
}

fn validate_bounds(bounds: &LayoutBounds, field: &str, errors: &mut Vec<String>) {
    if bounds.w <= 0.0 || bounds.h <= 0.0 {
        errors.push(format!("{field}.w and {field}.h must be positive"));
    }
}

fn validate_layout_node(node: &LayoutNode, pack_dir: &Path, errors: &mut Vec<String>) {
    match node {
        LayoutNode::Stack(f)
        | LayoutNode::Row(f)
        | LayoutNode::Column(f)
        | LayoutNode::Overlay(f)
        | LayoutNode::Canvas(f) => {
            validate_bind(f.visible_when.as_deref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            for child in &f.children {
                validate_layout_node(child, pack_dir, errors);
            }
        }
        LayoutNode::Region(f) => {
            if !SHELL_SLOTS.contains(&f.slot.as_str()) {
                errors.push(format!(
                    "region slot \"{}\" must be one of: {}",
                    f.slot,
                    SHELL_SLOTS.join(", ")
                ));
            }
            validate_bind(f.visible_when.as_deref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            for child in &f.children {
                validate_layout_node(child, pack_dir, errors);
            }
        }
        LayoutNode::Decoration(f) => {
            validate_bind(f.visible_when.as_deref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_presentation(&f.presentation, pack_dir, errors);
        }
        LayoutNode::DragRegion(f) => {
            validate_bind(f.visible_when.as_deref(), "visibleWhen", errors);
            validate_bounds(&f.bounds, "bounds", errors);
        }
        LayoutNode::Button(f)
        | LayoutNode::Seekbar(f)
        | LayoutNode::Artwork(f)
        | LayoutNode::Transport(f)
        | LayoutNode::Visualizer(f)
        | LayoutNode::Volume(f)
        | LayoutNode::Queue(f)
        | LayoutNode::Time(f) => {
            validate_action(f.action.as_deref(), errors);
            validate_bind(f.bind.as_deref(), "bind", errors);
            validate_bind(f.disabled_when.as_deref(), "disabledWhen", errors);
            validate_bind(f.visible_when.as_deref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_presentation(&f.presentation, pack_dir, errors);
        }
        LayoutNode::ButtonGroup(f) => {
            validate_bind(f.visible_when.as_deref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_presentation(&f.presentation, pack_dir, errors);
        }
        LayoutNode::Text(f) => {
            validate_bind(f.bind.as_deref(), "bind", errors);
            validate_bind(f.visible_when.as_deref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_presentation(&f.presentation, pack_dir, errors);
        }
    }
}

fn validate_visualizer_dimension(
    dim: Option<&SkinVisualizerDimension>,
    field: &str,
    errors: &mut Vec<String>,
) {
    let Some(dim) = dim else {
        return;
    };
    match dim {
        SkinVisualizerDimension::Pixels(n) => {
            if *n == 0 {
                errors.push(format!("{field} pixel value must be at least 1"));
            }
        }
        SkinVisualizerDimension::Keyword(k) => {
            let valid_width = ["fill"];
            let valid_height = ["flex", "fill"];
            let ok = if field.ends_with(".width") {
                valid_width.contains(&k.as_str())
            } else {
                valid_height.contains(&k.as_str())
            };
            if !ok {
                let allowed = if field.ends_with(".width") {
                    "fill or a positive pixel number"
                } else {
                    "flex, fill, or a positive pixel number"
                };
                errors.push(format!("{field} \"{k}\" must be {allowed}"));
            }
        }
    }
}

fn validate_manifest(manifest: &SkinManifest, pack_dir: &Path) -> Result<(), String> {
    let mut errors: Vec<String> = Vec::new();

    if manifest.version != 1 {
        errors.push(format!(
            "unsupported skin version {} (expected 1)",
            manifest.version
        ));
    }
    if manifest.name.trim().is_empty() {
        errors.push("skin name cannot be empty".to_string());
    }
    if !manifest.views.contains_key(&manifest.default_view) {
        errors.push(format!(
            "defaultView \"{}\" is not defined in views",
            manifest.default_view
        ));
    }
    if let Some(styles) = &manifest.text_styles {
        for (name, style) in styles {
            if style.role.as_ref().is_some_and(|role| role.trim().is_empty()) {
                errors.push(format!("textStyles.{name}.role cannot be empty"));
            }
        }
    }
    if let Some(sheet) = &manifest.stylesheet {
        if sheet.contains("..") || sheet.starts_with('/') {
            errors.push(format!(
                "stylesheet \"{sheet}\" must be a relative path under the skin pack root"
            ));
        } else {
            let path = pack_dir.join(sheet);
            if !path.is_file() {
                errors.push(format!(
                    "stylesheet not found: {}",
                    path.display()
                ));
            }
        }
    }
    if let Some(viz) = &manifest.visualizer {
        if let Some(pack) = &viz.pack {
            let trimmed = pack.trim();
            if trimmed.is_empty() {
                errors.push("visualizer.pack cannot be empty".to_string());
            }
        }
        if let Some(preset) = &viz.preset {
            if !["bars", "wave", "spectrum"].contains(&preset.as_str()) {
                errors.push(format!(
                    "visualizer.preset \"{preset}\" must be bars, wave, or spectrum"
                ));
            }
        }
        if let Some(placement) = &viz.placement {
            if placement != "top" && placement != "bottom" {
                errors.push(format!(
                    "visualizer.placement \"{placement}\" must be top or bottom"
                ));
            }
        }
        if let Some(display) = &viz.display {
            if display != "mini" && display != "panel" {
                errors.push(format!(
                    "visualizer.display \"{display}\" must be mini or panel"
                ));
            }
        }
        if let Some(size) = &viz.size {
            validate_visualizer_dimension(size.width.as_ref(), "visualizer.size.width", &mut errors);
            validate_visualizer_dimension(size.height.as_ref(), "visualizer.size.height", &mut errors);
        }
    }

    for (view_name, view) in &manifest.views {
        if let Some(mode) = &view.layout_mode {
            if mode != "slots" && mode != "canvas" {
                errors.push(format!(
                    "views.{view_name}.layoutMode \"{mode}\" must be slots or canvas"
                ));
            }
            if mode == "canvas" {
                if view.canvas.is_none() {
                    errors.push(format!(
                        "views.{view_name} with layoutMode canvas requires a canvas {{ width, height }}"
                    ));
                }
            }
        }
        validate_layout_node(&view.layout, pack_dir, &mut errors);
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

fn load_pack_from_dir(pack_dir: &Path, is_builtin: bool) -> Result<LoadedSkinPack, String> {
    let id = skin_id_from_dir(pack_dir)
        .ok_or_else(|| format!("invalid skin folder: {}", pack_dir.display()))?;
    let manifest_path = pack_dir.join("skin.json");
    if !manifest_path.is_file() {
        return Err(format!(
            "skin pack \"{id}\" is missing skin.json at {}",
            manifest_path.display()
        ));
    }

    let manifest = read_manifest(&manifest_path)?;
    validate_manifest(&manifest, pack_dir)?;

    let preview_path = ["preview.png", "preview.webp"]
        .iter()
        .map(|name| pack_dir.join(name))
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned());

    let summary = SkinSummary {
        id: id.clone(),
        name: manifest.name.clone(),
        author: manifest.author.clone(),
        description: manifest.description.clone(),
        is_builtin,
        preview_path,
    };

    Ok(LoadedSkinPack {
        summary,
        pack_dir: pack_dir.to_string_lossy().into_owned(),
        manifest,
    })
}

fn list_builtin_packs(app: &AppHandle) -> Vec<LoadedSkinPack> {
    let root = builtin_skins_root(app);
    if !root.is_dir() {
        return vec![];
    }

    let mut packs = Vec::new();
    let entries = match fs::read_dir(&root) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("builtin skins directory read error: {e}");
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
                let id = skin_id_from_dir(&path).unwrap_or_default();
                eprintln!("built-in skin \"{id}\" failed to load: {e}");
            }
        }
    }

    packs.sort_by(|a, b| a.summary.name.cmp(&b.summary.name));
    packs
}

fn list_user_packs(app: &AppHandle) -> Vec<LoadedSkinPack> {
    let dir = match skins_dir(app) {
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
            eprintln!("skins directory read error: {e}");
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
            Err(e) => eprintln!("user skin at {} skipped: {e}", path.display()),
        }
    }

    packs.sort_by(|a, b| a.summary.name.cmp(&b.summary.name));
    packs
}

#[tauri::command]
pub fn list_skins(app: AppHandle) -> Result<Vec<SkinSummary>, String> {
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
pub fn load_skin_pack(app: AppHandle, skin_id: String) -> Result<LoadedSkinPack, String> {
    let builtin_dir = builtin_skins_root(&app).join(&skin_id);
    if builtin_dir.is_dir() {
        return load_pack_from_dir(&builtin_dir, true);
    }

    let user_dir = skins_dir(&app)?.join(&skin_id);
    if user_dir.is_dir() {
        return load_pack_from_dir(&user_dir, false);
    }

    Err(format!(
        "skin \"{skin_id}\" was not found in built-in or user skins folders"
    ))
}

#[tauri::command]
pub fn save_active_skin_id(app: AppHandle, skin_id: String) -> Result<(), String> {
    let mut app_settings = settings::read_settings(&app);
    app_settings.active_skin = skin_id;
    settings::write_settings(&app, &app_settings)
}

#[tauri::command]
pub fn get_active_skin_id(app: AppHandle) -> Result<String, String> {
    Ok(settings::read_settings(&app).active_skin)
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

#[tauri::command]
pub fn open_skins_folder(app: AppHandle) -> Result<(), String> {
    let dir = ensure_skins_dir(&app)?;
    app.opener()
        .open_path(dir.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| format!("failed to open skins folder: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_builtin_skins_load() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("skins/builtin");
        let entries = fs::read_dir(&root).expect("builtin skins directory should exist");
        let mut loaded = 0usize;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            load_pack_from_dir(&path, true)
                .unwrap_or_else(|e| panic!("built-in skin at {} should load: {e}", path.display()));
            loaded += 1;
        }
        assert!(loaded > 0, "expected at least one built-in skin pack");
    }
}
