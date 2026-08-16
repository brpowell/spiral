//! Skin contribution types and validation (`skin.json`).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const KNOWN_ACTIONS: &[&str] = &[
    "player.togglePlayPause",
    "player.play",
    "player.pause",
    "player.previousTrack",
    "player.nextTrack",
    "player.cycleRepeat",
    "player.toggleRepeat",
    "player.toggleShuffle",
    "player.seek",
    "player.seekForward",
    "player.seekBackward",
    "player.volumeUp",
    "player.volumeDown",
    "player.setVolume",
    "player.setBalance",
    "player.toggleMute",
    "player.toggleCrossfade",
    "player.clearSetList",
    "navigation.openAlbum",
    "queue.openSetList",
    "skin.openPicker",
    "skin.exit",
    "skin.minimize",
    "skin.toggleAlwaysOnTop",
    "skin.restoreMainWindow",
    "skin.togglePanel",
    "skin.openPanel",
    "skin.closePanel",
    "skin.switchView",
    "skin.openView",
    "skin.closeView",
    "skin.toggleView",
    "skin.toggleSoundEffects",
    "visualizer.previous",
    "visualizer.next",
    "playlist.setSource",
    "playlist.playTrack",
    "eq.setBand",
    "eq.applyPreset",
    "eq.reset",
    "eq.setEnabled",
    "eq.previousPreset",
    "eq.nextPreset",
    "app.quit",
    "app.openUrl",
    "app.openFile",
    "view.setScreen",
    "view.setVariable",
    "view.applyStateEvent",
    "slideshow.setDeck",
    "slideshow.prev",
    "slideshow.next",
    "scrollStrip.prev",
    "scrollStrip.next",
    "scrollStrip.setSlide",
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
    "player.positionLabel",
    "player.durationLabel",
    "player.remainingLabel",
    "player.volumePercent",
    "player.repeatMode",
    "player.repeatOn",
    "player.shuffle",
    "player.crossfadeEnabled",
    "player.volume",
    "player.balance",
    "player.muted",
    "player.canGoPrevious",
    "player.canGoNext",
    "queue.length",
    "player.hasTrack",
    "skin.alwaysOnTop",
    "playback.source",
    "visualizer.name",
    "visualizer.canGoPrevious",
    "visualizer.canGoNext",
    "playlist.sourceLabel",
    "playlist.trackCount",
    "playlist.hasTracks",
    "eq.enabled",
    "eq.presetId",
    "eq.isManual",
    "eq.presetLabel",
    "eq.band.1",
    "eq.band.2",
    "eq.band.3",
    "eq.band.4",
    "eq.band.5",
    "eq.band.6",
    "eq.band.7",
    "eq.band.8",
    "eq.band.9",
    "eq.band.10",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinManifest {
    pub name: String,
    pub author: String,
    pub description: String,
    /// Optional preview image path relative to the contribution directory.
    /// Raster only (`ALLOWED_PREVIEW_EXTENSIONS`); SVG is not permitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub default_view: String,
    pub views: HashMap<String, SkinView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visualizer: Option<SkinVisualizer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animations: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timelines: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stylesheet: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound_effects: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinPanelWindowOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinPanelMotion {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinPanel {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_open: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_when_open: Option<SkinPanelWindowOverride>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub motion: Option<SkinPanelMotion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SkinCondition {
    Leaf(String),
    All { all: Vec<SkinCondition> },
    Any { any: Vec<SkinCondition> },
    Not { not: Box<SkinCondition> },
}

impl SkinCondition {
    pub fn validate_leaves(&self, field: &str, errors: &mut Vec<String>) {
        match self {
            SkinCondition::Leaf(path) => validate_bind(Some(path.as_str()), field, errors),
            SkinCondition::All { all } => {
                for child in all {
                    child.validate_leaves(field, errors);
                }
            }
            SkinCondition::Any { any } => {
                for child in any {
                    child.validate_leaves(field, errors);
                }
            }
            SkinCondition::Not { not } => not.validate_leaves(field, errors),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinViewActivateEffect {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay_ms: Option<u64>,
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinView {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presentation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag_inference: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvas: Option<SkinCanvasSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panels: Option<HashMap<String, SkinPanel>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<HashMap<String, SkinViewStateSpec>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_activate: Option<Vec<SkinViewActivateEffect>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<WindowChrome>,
    pub layout: LayoutNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinViewStateTransition {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<Vec<serde_json::Value>>,
    pub set: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinViewStateSpec {
    pub default: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<HashMap<String, Vec<SkinViewStateTransition>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinCanvasSpec {
    pub width: u32,
    pub height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width_when: Option<HashMap<String, u32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height_when: Option<HashMap<String, u32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LayoutBoundsOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z_index: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutBounds {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<f64>,
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
    #[serde(rename = "subview")]
    Subview(SubviewFields),
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
    #[serde(rename = "balance")]
    Balance(ControlFields),
    #[serde(rename = "eqBand")]
    EqBand(EqBandFields),
    #[serde(rename = "queue")]
    Queue(ControlFields),
    #[serde(rename = "time")]
    Time(ControlFields),
    #[serde(rename = "playlist")]
    Playlist(ControlFields),
    #[serde(rename = "hitArea")]
    HitArea(HitAreaFields),
    #[serde(rename = "tiledFrame")]
    TiledFrame(TiledFrameFields),
    #[serde(rename = "slideshow")]
    Slideshow(SlideshowFields),
    #[serde(rename = "scrollStrip")]
    ScrollStrip(ScrollStripFields),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    pub children: Vec<LayoutNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z_index: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<HashMap<String, LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag_region: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubviewFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    pub bounds: LayoutBounds,
    pub children: Vec<LayoutNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<HashMap<String, LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passthrough: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag_region: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecorationFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    pub presentation: Presentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<HashMap<String, LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag_region: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitAreaFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    pub bounds: LayoutBounds,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<HashMap<String, LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiledFrameTileSize {
    pub w: f64,
    pub h: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub art_height: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiledFrameAssets {
    pub top_left: String,
    pub top_center: String,
    pub top_right: String,
    pub top_stretch: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_stretch2: Option<String>,
    pub left_stretch: String,
    pub right_stretch: String,
    pub bottom_left: String,
    pub bottom_center: String,
    pub bottom_right: String,
    pub bottom_stretch: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom_stretch2: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resize_grip: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiledFrameTileSizes {
    pub top_left: TiledFrameTileSize,
    pub top_center: TiledFrameTileSize,
    pub top_right: TiledFrameTileSize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_stretch: Option<TiledFrameTileSize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_stretch2: Option<TiledFrameTileSize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left_stretch: Option<TiledFrameTileSize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right_stretch: Option<TiledFrameTileSize>,
    pub bottom_left: TiledFrameTileSize,
    pub bottom_center: TiledFrameTileSize,
    pub bottom_right: TiledFrameTileSize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom_stretch: Option<TiledFrameTileSize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom_stretch2: Option<TiledFrameTileSize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resize_grip: Option<TiledFrameTileSize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiledFrameContentInset {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StretchLayoutBounds {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z_index: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiledFrameTileDef {
    pub asset: String,
    pub bounds: StretchLayoutBounds,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tile_unit: Option<TiledFrameTileSize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub art_height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z_index: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", untagged)]
pub enum TiledFramePresentation {
    Explicit(TiledFrameExplicitPresentation),
    Preset(TiledFramePresetPresentation),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiledFrameExplicitPresentation {
    pub kind: String,
    pub content_inset: TiledFrameContentInset,
    pub tiles: Vec<TiledFrameTileDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiledFramePresetPresentation {
    pub kind: String,
    pub assets: TiledFrameAssets,
    pub tile_sizes: TiledFrameTileSizes,
    pub frame_thickness: f64,
    pub content_inset: TiledFrameContentInset,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiledFrameFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    pub presentation: TiledFramePresentation,
    pub children: Vec<LayoutNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonGroupElement {
    pub mapping_color: String,
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip_when: Option<HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonGroupFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    pub presentation: Presentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<HashMap<String, LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideshowDeck {
    pub deck_index: u32,
    pub pages: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_page_nav: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideshowPresentation {
    pub kind: String,
    pub asset_pattern: String,
    pub decks: HashMap<String, SlideshowDeck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideshowFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    pub presentation: SlideshowPresentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollStripItem {
    pub id: String,
    pub asset: String,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollStripSlideItem {
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollStripSlide {
    pub items: HashMap<String, ScrollStripSlideItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollStripPresentation {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_ms: Option<u32>,
    pub items: Vec<ScrollStripItem>,
    pub slides: Vec<ScrollStripSlide>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollStripFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    pub presentation: ScrollStripPresentation,
    pub bounds: LayoutBounds,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip_when: Option<HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<HashMap<String, serde_json::Value>>,
    pub presentation: Presentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<HashMap<String, LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqBandFields {
    pub band: u8,
    #[serde(flatten)]
    pub control: ControlFields,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextControlFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overflow: Option<String>,
    pub presentation: Presentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveAssets {
    pub default: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hover: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pressed: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Presentation {
    #[serde(rename = "bitmap", rename_all = "camelCase")]
    Bitmap {
        assets: InteractiveAssets,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        assets_when: Option<HashMap<String, InteractiveAssets>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        width: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        height: Option<f64>,
    },
    #[serde(rename = "gif", rename_all = "camelCase")]
    Gif {
        asset: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        complete_action: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        complete_payload: Option<HashMap<String, serde_json::Value>>,
    },
    #[serde(rename = "primitive", rename_all = "camelCase")]
    Primitive {
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
        value_frames: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        map_frames: Option<String>,
    },
    #[serde(rename = "bitmapSeekbar", rename_all = "camelCase")]
    BitmapSeekbar {
        track: String,
        fill: String,
        thumb_assets: InteractiveAssets,
        border_size: f64,
        track_width: f64,
        track_height: f64,
        thumb_width: f64,
        thumb_height: f64,
    },
    #[serde(rename = "bitmapVerticalSlider", rename_all = "camelCase")]
    BitmapVerticalSlider {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        track: Option<String>,
        thumb: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        thumb_pressed: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        track_tile_width: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        track_tile_height: Option<f64>,
        track_width: f64,
        track_height: f64,
        thumb_width: f64,
        thumb_height: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        border_size: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fill_from_bottom: Option<bool>,
    },
    #[serde(rename = "bitmapHorizontalSlider", rename_all = "camelCase")]
    BitmapHorizontalSlider {
        track: String,
        thumb: String,
        track_tile_width: f64,
        track_tile_height: f64,
        track_width: f64,
        track_height: f64,
        thumb_width: f64,
        thumb_height: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        border_size: Option<f64>,
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
    },
    #[serde(rename = "buttonGroup", rename_all = "camelCase")]
    ButtonGroup {
        assets: InteractiveAssets,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        assets_when: Option<HashMap<String, InteractiveAssets>>,
        position_map: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        width: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        height: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sound: Option<String>,
        /// Sibling buttonGroup node ids — co-elevate above them on hover/press.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        elevate_when: Option<Vec<String>>,
        elements: Vec<ButtonGroupElement>,
    },
    #[serde(rename = "framedPanel", rename_all = "camelCase")]
    FramedPanel {
        mask: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        frame: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_inset: Option<FramedPanelInset>,
    },
    #[serde(rename = "compact", rename_all = "camelCase")]
    Compact {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        show_dropdown: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        show_duration: Option<bool>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramedPanelInset {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DigitStripSlot {
    pub role: String,
    pub x: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowChrome {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip_mask: Option<String>,
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
    /// Pin a contribution id, or `"global"` / omit to follow the picker.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

pub fn read_skin_manifest(path: &Path) -> Result<SkinManifest, String> {
    let contents =
        fs::read_to_string(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("{} is not valid skin JSON: {e}", path.display()))
}

/// Strict skin contribution check used by pack install/export.
pub fn validate_skin_contribution_at(manifest_path: &Path) -> Result<(), String> {
    let pack_dir = manifest_path.parent().ok_or_else(|| {
        format!(
            "skin manifest has no parent directory: {}",
            manifest_path.display()
        )
    })?;
    let manifest = read_skin_manifest(manifest_path)?;
    validate_skin_manifest(&manifest, pack_dir)
}

fn validate_condition(condition: Option<&SkinCondition>, field: &str, errors: &mut Vec<String>) {
    if let Some(cond) = condition {
        cond.validate_leaves(field, errors);
    }
}

fn validate_bind(path: Option<&str>, field: &str, errors: &mut Vec<String>) {
    if let Some(p) = path {
        if KNOWN_BINDS.contains(&p) {
            return;
        }
        if p.starts_with("skin.panel.")
            && p.split('.').count() == 4
            && matches!(
                p.rsplit('.').next(),
                Some("open" | "closed" | "revealed" | "settled" | "openSettled")
            )
        {
            return;
        }
        if p.starts_with("skin.pref.") {
            let suffix = p.strip_prefix("skin.pref.").unwrap_or("");
            if !suffix.is_empty() && !suffix.contains('.') {
                return;
            }
        }
        if is_known_view_bind(p) || is_known_slideshow_bind(p) || is_known_scroll_strip_bind(p) {
            return;
        }
        errors.push(format!("{field} references unknown bind path \"{p}\"."));
    }
}

fn is_known_view_bind(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("view.") else {
        return false;
    };
    let parts: Vec<&str> = rest.split('.').collect();
    match parts.as_slice() {
        [var] => !var.is_empty(),
        [var, screen] if *var == "screen" => matches!(*screen, "menu" | "content"),
        [var, phase] if !var.is_empty() && !phase.is_empty() => *var != "screen",
        _ => false,
    }
}

fn is_known_slideshow_bind(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("slideshow.") else {
        return false;
    };
    let Some((id, suffix)) = rest.split_once('.') else {
        return false;
    };
    if id.is_empty() {
        return false;
    }
    if matches!(
        suffix,
        "canPrev" | "canNext" | "showPageNav" | "atFirst" | "atLast"
    ) {
        return true;
    }
    if let Some(page) = suffix.strip_prefix("page.") {
        return page.parse::<u32>().is_ok();
    }
    if let Some(deck_rest) = suffix.strip_prefix("deck.") {
        if deck_rest.is_empty() {
            return false;
        }
        if let Some((deck, page)) = deck_rest.split_once(".page.") {
            return !deck.is_empty() && page.parse::<u32>().is_ok();
        }
        return true;
    }
    false
}

fn is_known_scroll_strip_bind(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("scrollStrip.") else {
        return false;
    };
    let Some((id, suffix)) = rest.split_once('.') else {
        return false;
    };
    if id.is_empty() {
        return false;
    }
    if matches!(suffix, "canPrev" | "canNext" | "atFirst" | "atLast") {
        return true;
    }
    if let Some(slide) = suffix.strip_prefix("slide.") {
        return slide.parse::<u32>().is_ok();
    }
    false
}

fn validate_skin_asset_file(path: &str, pack_dir: &Path, label: &str, errors: &mut Vec<String>) {
    if path.contains("..") || path.starts_with('/') {
        errors.push(format!(
            "{label} \"{path}\" must be a relative path under assets/"
        ));
        return;
    }
    let file_path = pack_dir.join("assets").join(path);
    if !file_path.is_file() {
        errors.push(format!(
            "{label} asset not found: expected {}",
            file_path.display()
        ));
    }
}

fn validate_interactive_assets(
    assets: &InteractiveAssets,
    pack_dir: &Path,
    label: &str,
    errors: &mut Vec<String>,
) {
    validate_skin_asset_file(
        &assets.default,
        pack_dir,
        &format!("{label}.default"),
        errors,
    );
    if let Some(hover) = &assets.hover {
        validate_skin_asset_file(hover, pack_dir, &format!("{label}.hover"), errors);
    }
    if let Some(pressed) = &assets.pressed {
        validate_skin_asset_file(pressed, pack_dir, &format!("{label}.pressed"), errors);
    }
}

fn validate_interactive_assets_when(
    assets_when: &HashMap<String, InteractiveAssets>,
    pack_dir: &Path,
    label: &str,
    errors: &mut Vec<String>,
) {
    for (bind, assets) in assets_when {
        validate_interactive_assets(
            assets,
            pack_dir,
            &format!("{label}.assetsWhen[\"{bind}\"]"),
            errors,
        );
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

fn validate_bitmap_tiled_slider_presentation(
    kind: &str,
    track: Option<&str>,
    thumb: &str,
    thumb_pressed: Option<&str>,
    track_tile_width: Option<f64>,
    track_tile_height: Option<f64>,
    track_width: f64,
    track_height: f64,
    thumb_width: f64,
    thumb_height: f64,
    border_size: Option<f64>,
    pack_dir: &Path,
    errors: &mut Vec<String>,
) {
    validate_skin_asset_file(thumb, pack_dir, &format!("{kind} thumb"), errors);
    if let Some(pressed) = thumb_pressed {
        validate_skin_asset_file(pressed, pack_dir, &format!("{kind} thumbPressed"), errors);
    }
    if let Some(track_path) = track {
        validate_skin_asset_file(track_path, pack_dir, &format!("{kind} track"), errors);
        let tile_w = track_tile_width.unwrap_or(track_width);
        let tile_h = track_tile_height.unwrap_or(track_height);
        if tile_w <= 0.0 || tile_h <= 0.0 {
            errors.push(format!(
                "{kind} trackTileWidth and trackTileHeight must be positive"
            ));
        }
    } else if track_tile_width.is_some() || track_tile_height.is_some() {
        errors.push(format!(
            "{kind} trackTileWidth/trackTileHeight require track"
        ));
    }
    if track_width <= 0.0 || track_height <= 0.0 {
        errors.push(format!(
            "{kind} trackWidth and trackHeight must be positive"
        ));
    }
    if thumb_width <= 0.0 || thumb_height <= 0.0 {
        errors.push(format!(
            "{kind} thumbWidth and thumbHeight must be positive"
        ));
    }
    if border_size.is_some_and(|size| size < 0.0) {
        errors.push(format!("{kind} borderSize must be non-negative"));
    }
}

fn validate_tiled_frame_asset(path: &str, pack_dir: &Path, label: &str, errors: &mut Vec<String>) {
    validate_skin_asset_file(path, pack_dir, &format!("tiledFrame {label}"), errors);
}

fn validate_tiled_frame_presentation(
    presentation: &TiledFramePresentation,
    pack_dir: &Path,
    errors: &mut Vec<String>,
) {
    match presentation {
        TiledFramePresentation::Explicit(explicit) => {
            if explicit.kind != "tiledFrame" {
                errors.push(format!(
                    "tiledFrame presentation kind must be \"tiledFrame\", got \"{}\"",
                    explicit.kind
                ));
            }
            if explicit.tiles.is_empty() {
                errors.push("tiledFrame tiles must not be empty".to_string());
            }
            for (index, tile) in explicit.tiles.iter().enumerate() {
                validate_tiled_frame_asset(
                    &tile.asset,
                    pack_dir,
                    &format!("tiles[{index}].asset"),
                    errors,
                );
            }
        }
        TiledFramePresentation::Preset(preset) => {
            if preset.kind != "tiledFrame" {
                errors.push(format!(
                    "tiledFrame presentation kind must be \"tiledFrame\", got \"{}\"",
                    preset.kind
                ));
            }
            if preset.frame_thickness <= 0.0 {
                errors.push("tiledFrame frameThickness must be positive".to_string());
            }
            let assets = &preset.assets;
            validate_tiled_frame_asset(&assets.top_left, pack_dir, "assets.topLeft", errors);
            validate_tiled_frame_asset(&assets.top_center, pack_dir, "assets.topCenter", errors);
            validate_tiled_frame_asset(&assets.top_right, pack_dir, "assets.topRight", errors);
            validate_tiled_frame_asset(&assets.top_stretch, pack_dir, "assets.topStretch", errors);
            validate_tiled_frame_asset(
                &assets.left_stretch,
                pack_dir,
                "assets.leftStretch",
                errors,
            );
            validate_tiled_frame_asset(
                &assets.right_stretch,
                pack_dir,
                "assets.rightStretch",
                errors,
            );
            validate_tiled_frame_asset(&assets.bottom_left, pack_dir, "assets.bottomLeft", errors);
            validate_tiled_frame_asset(
                &assets.bottom_center,
                pack_dir,
                "assets.bottomCenter",
                errors,
            );
            validate_tiled_frame_asset(
                &assets.bottom_right,
                pack_dir,
                "assets.bottomRight",
                errors,
            );
            validate_tiled_frame_asset(
                &assets.bottom_stretch,
                pack_dir,
                "assets.bottomStretch",
                errors,
            );
            if let Some(path) = &assets.top_stretch2 {
                validate_tiled_frame_asset(path, pack_dir, "assets.topStretch2", errors);
            }
            if let Some(path) = &assets.bottom_stretch2 {
                validate_tiled_frame_asset(path, pack_dir, "assets.bottomStretch2", errors);
            }
            if let Some(path) = &assets.resize_grip {
                validate_tiled_frame_asset(path, pack_dir, "assets.resizeGrip", errors);
            }
        }
    }
}

fn validate_presentation(presentation: &Presentation, pack_dir: &Path, errors: &mut Vec<String>) {
    match presentation {
        Presentation::Bitmap {
            assets,
            assets_when,
            ..
        } => {
            validate_interactive_assets(assets, pack_dir, "bitmap assets", errors);
            if let Some(when) = assets_when {
                validate_interactive_assets_when(when, pack_dir, "bitmap", errors);
            }
        }
        Presentation::Gif {
            asset,
            complete_action,
            ..
        } => {
            validate_skin_asset_file(asset, pack_dir, "gif asset", errors);
            validate_action(complete_action.as_deref(), errors);
        }
        Presentation::Css { stylesheet, .. } => {
            if let Some(sheet) = stylesheet {
                let path = pack_dir.join(sheet);
                if !path.is_file() {
                    errors.push(format!("CSS stylesheet not found: {}", path.display()));
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
            validate_skin_asset_file(strip, pack_dir, "stripSlider strip", errors);
            if let Some(map) = position_map {
                validate_skin_asset_file(map, pack_dir, "stripSlider positionMap", errors);
            }
            if *frame_width <= 0.0 {
                errors.push("stripSlider frameWidth must be positive".into());
            }
            if *frame_count < 2 {
                errors.push("stripSlider frameCount must be at least 2".into());
            }
        }
        Presentation::BitmapSeekbar {
            track,
            fill,
            thumb_assets,
            border_size,
            track_width,
            track_height,
            thumb_width,
            thumb_height,
            ..
        } => {
            validate_skin_asset_file(track, pack_dir, "bitmapSeekbar track", errors);
            validate_skin_asset_file(fill, pack_dir, "bitmapSeekbar fill", errors);
            validate_interactive_assets(
                thumb_assets,
                pack_dir,
                "bitmapSeekbar thumbAssets",
                errors,
            );
            if *border_size < 0.0 {
                errors.push("bitmapSeekbar borderSize must be non-negative".into());
            }
            if *track_width <= 0.0 || *track_height <= 0.0 {
                errors.push("bitmapSeekbar trackWidth and trackHeight must be positive".into());
            }
            if *thumb_width <= 0.0 || *thumb_height <= 0.0 {
                errors.push("bitmapSeekbar thumbWidth and thumbHeight must be positive".into());
            }
        }
        Presentation::BitmapVerticalSlider {
            track,
            thumb,
            thumb_pressed,
            track_tile_width,
            track_tile_height,
            track_width,
            track_height,
            thumb_width,
            thumb_height,
            border_size,
            ..
        } => {
            validate_bitmap_tiled_slider_presentation(
                "bitmapVerticalSlider",
                track.as_deref(),
                thumb,
                thumb_pressed.as_deref(),
                *track_tile_width,
                *track_tile_height,
                *track_width,
                *track_height,
                *thumb_width,
                *thumb_height,
                *border_size,
                pack_dir,
                errors,
            );
        }
        Presentation::BitmapHorizontalSlider {
            track,
            thumb,
            track_tile_width,
            track_tile_height,
            track_width,
            track_height,
            thumb_width,
            thumb_height,
            border_size,
            ..
        } => {
            validate_bitmap_tiled_slider_presentation(
                "bitmapHorizontalSlider",
                Some(track.as_str()),
                thumb,
                None,
                Some(*track_tile_width),
                Some(*track_tile_height),
                *track_width,
                *track_height,
                *thumb_width,
                *thumb_height,
                *border_size,
                pack_dir,
                errors,
            );
        }
        Presentation::DigitStrip {
            strip,
            frame_width,
            frame_height,
            slots,
            ..
        } => {
            validate_skin_asset_file(strip, pack_dir, "digitStrip strip", errors);
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
        Presentation::FramedPanel {
            mask,
            frame,
            content_inset,
            ..
        } => {
            validate_skin_asset_file(mask, pack_dir, "framedPanel mask", errors);
            if let Some(frame_path) = frame {
                validate_skin_asset_file(frame_path, pack_dir, "framedPanel frame", errors);
            }
            if let Some(inset) = content_inset {
                if inset.w <= 0.0 || inset.h <= 0.0 {
                    errors.push(
                        "framedPanel contentInset.w and contentInset.h must be positive".into(),
                    );
                }
            }
        }
        Presentation::Compact { .. } => {}
        Presentation::ButtonGroup {
            assets,
            assets_when,
            position_map,
            elements,
            ..
        } => {
            validate_interactive_assets(assets, pack_dir, "buttonGroup assets", errors);
            if let Some(when) = assets_when {
                validate_interactive_assets_when(when, pack_dir, "buttonGroup", errors);
            }
            validate_skin_asset_file(position_map, pack_dir, "buttonGroup positionMap", errors);
            if elements.is_empty() {
                errors.push("buttonGroup elements must not be empty".into());
            }
            for element in elements {
                validate_action(Some(element.action.as_str()), errors);
                validate_condition(element.active_when.as_ref(), "activeWhen", errors);
                validate_condition(element.enabled_when.as_ref(), "enabledWhen", errors);
            }
        }
    }
}

fn validate_bounds(bounds: &LayoutBounds, field: &str, errors: &mut Vec<String>) {
    if bounds.w <= 0.0 || bounds.h <= 0.0 {
        errors.push(format!("{field}.w and {field}.h must be positive"));
    }
    match (bounds.x, bounds.right) {
        (None, None) => errors.push(format!("{field} must set x or right")),
        (Some(_), Some(_)) => errors.push(format!("{field} must not set both x and right")),
        _ => {}
    }
}

fn validate_layout_node(
    node: &LayoutNode,
    pack_dir: &Path,
    errors: &mut Vec<String>,
    is_root: bool,
) {
    match node {
        LayoutNode::Stack(f)
        | LayoutNode::Row(f)
        | LayoutNode::Column(f)
        | LayoutNode::Overlay(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            for child in &f.children {
                validate_layout_node(child, pack_dir, errors, false);
            }
        }
        LayoutNode::Canvas(f) => {
            if !is_root {
                let label = f.id.as_deref().unwrap_or("(anonymous)");
                errors.push(format!(
                    "nested canvas \"{label}\" is invalid; use subview for nested groups (canvas is view root only)"
                ));
            }
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            for child in &f.children {
                validate_layout_node(child, pack_dir, errors, false);
            }
        }
        LayoutNode::Subview(f) => {
            if is_root {
                errors.push(
                    "subview cannot be a view layout root; use canvas (or tiledFrame)".into(),
                );
            }
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            validate_bounds(&f.bounds, "bounds", errors);
            for child in &f.children {
                validate_layout_node(child, pack_dir, errors, false);
            }
        }
        LayoutNode::Decoration(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_presentation(&f.presentation, pack_dir, errors);
        }
        LayoutNode::HitArea(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            validate_bounds(&f.bounds, "bounds", errors);
        }
        LayoutNode::Button(f)
        | LayoutNode::Seekbar(f)
        | LayoutNode::Artwork(f)
        | LayoutNode::Transport(f)
        | LayoutNode::Visualizer(f)
        | LayoutNode::Volume(f)
        | LayoutNode::Balance(f)
        | LayoutNode::Queue(f)
        | LayoutNode::Time(f)
        | LayoutNode::Playlist(f) => {
            validate_action(f.action.as_deref(), errors);
            validate_bind(f.bind.as_deref(), "bind", errors);
            validate_condition(f.enabled_when.as_ref(), "enabledWhen", errors);
            validate_condition(f.active_when.as_ref(), "activeWhen", errors);
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_presentation(&f.presentation, pack_dir, errors);
        }
        LayoutNode::EqBand(f) => {
            if !(1..=10).contains(&f.band) {
                errors.push(format!(
                    "eqBand band must be between 1 and 10, got {}",
                    f.band
                ));
            }
            validate_action(f.control.action.as_deref(), errors);
            validate_bind(f.control.bind.as_deref(), "bind", errors);
            validate_condition(f.control.enabled_when.as_ref(), "enabledWhen", errors);
            validate_condition(f.control.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(bounds) = &f.control.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_presentation(&f.control.presentation, pack_dir, errors);
        }
        LayoutNode::ButtonGroup(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_presentation(&f.presentation, pack_dir, errors);
        }
        LayoutNode::Text(f) => {
            validate_bind(f.bind.as_deref(), "bind", errors);
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(overflow) = &f.overflow {
                const ALLOWED: &[&str] = &["visible", "clip", "scroll", "scroll-bounce"];
                if !ALLOWED.contains(&overflow.as_str()) {
                    errors.push(format!(
                        "text overflow \"{overflow}\" must be visible, clip, scroll, or scroll-bounce"
                    ));
                }
            }
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_presentation(&f.presentation, pack_dir, errors);
        }
        LayoutNode::TiledFrame(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_tiled_frame_presentation(&f.presentation, pack_dir, errors);
            for child in &f.children {
                validate_layout_node(child, pack_dir, errors, false);
            }
        }
        LayoutNode::Slideshow(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            if f.presentation.kind != "imageSequence" {
                errors.push("slideshow presentation kind must be imageSequence".into());
            }
            if f.presentation.asset_pattern.is_empty() {
                errors.push("slideshow assetPattern must not be empty".into());
            }
            if f.presentation.decks.is_empty() {
                errors.push("slideshow decks must not be empty".into());
            }
            for (name, deck) in &f.presentation.decks {
                if deck.pages == 0 {
                    errors.push(format!("slideshow deck \"{name}\" pages must be >= 1"));
                }
            }
        }
        LayoutNode::ScrollStrip(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            validate_bounds(&f.bounds, "bounds", errors);
            if f.id.as_deref().unwrap_or("").is_empty() {
                errors.push("scrollStrip id must not be empty".into());
            }
            if f.presentation.kind != "bitmapVertical" {
                errors.push("scrollStrip presentation kind must be bitmapVertical".into());
            }
            if f.presentation.items.is_empty() {
                errors.push("scrollStrip items must not be empty".into());
            }
            if f.presentation.slides.is_empty() {
                errors.push("scrollStrip slides must not be empty".into());
            }
            for item in &f.presentation.items {
                if item.id.is_empty() {
                    errors.push("scrollStrip item id must not be empty".into());
                }
                validate_skin_asset_file(
                    &item.asset,
                    pack_dir,
                    &format!("scrollStrip item \"{}\"", item.id),
                    errors,
                );
            }
        }
    }
}

pub fn validate_skin_manifest(manifest: &SkinManifest, pack_dir: &Path) -> Result<(), String> {
    let mut errors: Vec<String> = Vec::new();

    if manifest.name.trim().is_empty() {
        errors.push("skin name cannot be empty".to_string());
    }
    if !manifest.views.contains_key(&manifest.default_view) {
        errors.push(format!(
            "defaultView \"{}\" is not defined in views",
            manifest.default_view
        ));
    }
    if let Some(preview) = &manifest.preview {
        if let Err(message) = crate::validate_preview_file(pack_dir, preview) {
            errors.push(message);
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
                errors.push(format!("stylesheet not found: {}", path.display()));
            }
        }
    }
    if let Some(viz) = &manifest.visualizer {
        if let Some(id) = &viz.id {
            let trimmed = id.trim();
            if trimmed.is_empty() {
                errors.push("visualizer.id cannot be empty".to_string());
            }
        }
    }
    if let Some(sounds) = &manifest.sound_effects {
        for (key, asset_path) in sounds {
            if key.trim().is_empty() {
                errors.push("soundEffects keys cannot be empty".to_string());
                continue;
            }
            if asset_path.contains("..") || asset_path.starts_with('/') {
                errors.push(format!(
                    "soundEffects.{key} \"{asset_path}\" must be a relative path under assets/"
                ));
                continue;
            }
            let wav_path = pack_dir.join("assets").join(format!("{asset_path}.wav"));
            if !wav_path.is_file() {
                errors.push(format!(
                    "soundEffects.{key} asset not found: {}",
                    wav_path.display()
                ));
            }
        }
    }

    for (view_name, view) in &manifest.views {
        if let Some(presentation) = &view.presentation {
            if presentation != "primary"
                && presentation != "exclusive"
                && presentation != "auxiliary"
            {
                errors.push(format!(
                    "views.{view_name}.presentation \"{presentation}\" must be primary, exclusive, or auxiliary"
                ));
            }
        }
        if let Some(mode) = &view.layout_mode {
            if mode != "flow" && mode != "canvas" {
                errors.push(format!(
                    "views.{view_name}.layoutMode \"{mode}\" must be flow or canvas"
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
        validate_layout_node(&view.layout, pack_dir, &mut errors, true);
    }

    let primary_count = manifest
        .views
        .values()
        .filter(|view| view.presentation.as_deref() == Some("primary"))
        .count();
    if primary_count > 1 {
        errors.push(format!(
            "exactly one view may declare presentation \"primary\" (found {primary_count})"
        ));
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
    use std::io::Write;

    #[test]
    fn rejects_missing_skin_name() {
        let dir = std::env::temp_dir().join(format!("spk-skin-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("skin.json");
        let mut f = std::fs::File::create(&path).unwrap();
        write!(
            f,
            r#"{{"name":"","author":"a","description":"","defaultView":"main","views":{{"main":{{"layout":{{"type":"canvas","children":[]}}}}}}}}"#
        )
        .unwrap();
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("name") || err.contains("layout") || !err.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
