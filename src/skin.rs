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
    "skin.openPicker",
    "skin.exit",
    "skin.minimize",
    "skin.toggleAlwaysOnTop",
    "skin.restoreMainWindow",
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkinClickEffect {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay_ms: Option<u64>,
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkinLifecycleEffect {
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
    pub drag_inference: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<HashMap<String, SkinViewStateSpec>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_activate: Option<Vec<SkinLifecycleEffect>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<WindowChrome>,
    pub layout: ViewLayout,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinViewStateTransition {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<Vec<serde_json::Value>>,
    pub set: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinViewStateSpec {
    pub default: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<HashMap<String, Vec<SkinViewStateTransition>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ViewLayout {
    #[serde(rename = "canvas")]
    Canvas(CanvasFields),
    #[serde(rename = "row")]
    Row(ContainerFields),
    #[serde(rename = "column")]
    Column(ContainerFields),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<NodeStyle>,
    pub width: u32,
    pub height: u32,
    pub children: Vec<LayoutNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag_region: Option<bool>,
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
pub struct LayoutBounds {
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
#[serde(untagged)]
pub enum FontWeight {
    Number(u16),
    Keyword(String),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<FontWeight>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_align: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LayoutNode {
    #[serde(rename = "row")]
    Row(ContainerFields),
    #[serde(rename = "column")]
    Column(ContainerFields),
    #[serde(rename = "overlay")]
    Overlay(ContainerFields),
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
    #[serde(rename = "time")]
    Time(ControlFields),
    #[serde(rename = "playlist")]
    Playlist(PlaylistFields),
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<NodeStyle>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<NodeStyle>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<NodeStyle>,
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
pub struct TiledFrameTileDef {
    pub asset: String,
    pub bounds: LayoutBounds,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<NodeStyle>,
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
    pub on_click: Vec<SkinClickEffect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound_when: Option<HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip_when: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonGroupFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<NodeStyle>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<NodeStyle>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<NodeStyle>,
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
    pub style: Option<NodeStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_click: Option<Vec<SkinClickEffect>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound_when: Option<HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip_when: Option<HashMap<String, String>>,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextControlFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<NodeStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overflow: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<HashMap<String, LayoutBoundsOverride>>,
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
        on_complete: Option<Vec<SkinLifecycleEffect>>,
    },
    #[serde(rename = "primitive", rename_all = "camelCase")]
    Primitive {
        /// Library icon id (`setList` → `IconSetList`) or pack-relative asset under `assets/`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        icon: Option<String>,
        /// Visible label on primitive buttons (author content).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        /// Button chrome variant: `primary` | `secondary` | `ghost` | `danger` | `plain` (default ghost).
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        track: Option<String>,
        thumb: String,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaylistFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<NodeStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playing_row_style: Option<NodeStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_row_style: Option<NodeStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_dropdown: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_duration: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_artwork: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<HashMap<String, LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
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

fn validate_click_effects(effects: Option<&[SkinClickEffect]>, errors: &mut Vec<String>) {
    if let Some(effects) = effects {
        for effect in effects {
            validate_action(Some(effect.action.as_str()), errors);
            validate_condition(effect.when.as_ref(), "when", errors);
        }
    }
}

fn validate_lifecycle_effects(effects: Option<&[SkinLifecycleEffect]>, errors: &mut Vec<String>) {
    if let Some(effects) = effects {
        for effect in effects {
            validate_action(Some(effect.action.as_str()), errors);
            validate_condition(effect.when.as_ref(), "when", errors);
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

fn is_skin_asset_icon_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".png")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
}

fn is_library_icon_id(id: &str) -> bool {
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => chars.all(|c| c.is_ascii_alphanumeric()),
        _ => false,
    }
}

const PRIMITIVE_BUTTON_VARIANTS: &[&str] = &["primary", "secondary", "ghost", "danger", "plain"];

fn validate_primitive_presentation(
    icon: Option<&str>,
    variant: Option<&str>,
    pack_dir: &Path,
    errors: &mut Vec<String>,
) {
    if let Some(icon) = icon {
        if is_skin_asset_icon_path(icon) {
            validate_skin_asset_file(icon, pack_dir, "primitive icon", errors);
        } else if !is_library_icon_id(icon) {
            errors.push(format!(
                "primitive icon \"{icon}\" must be a camelCase library id or a pack-relative asset under assets/"
            ));
        }
    }
    if let Some(variant) = variant {
        if !PRIMITIVE_BUTTON_VARIANTS.contains(&variant) {
            errors.push(format!(
                "primitive variant \"{variant}\" must be one of: {}",
                PRIMITIVE_BUTTON_VARIANTS.join(", ")
            ));
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
            asset, on_complete, ..
        } => {
            validate_skin_asset_file(asset, pack_dir, "gif asset", errors);
            validate_lifecycle_effects(on_complete.as_deref(), errors);
        }
        Presentation::Css { stylesheet, .. } => {
            if let Some(sheet) = stylesheet {
                let path = pack_dir.join(sheet);
                if !path.is_file() {
                    errors.push(format!("CSS stylesheet not found: {}", path.display()));
                }
            }
        }
        Presentation::Primitive { icon, variant, .. } => {
            validate_primitive_presentation(icon.as_deref(), variant.as_deref(), pack_dir, errors);
        }
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
        } => {
            validate_bitmap_tiled_slider_presentation(
                "bitmapHorizontalSlider",
                track.as_deref(),
                thumb,
                None,
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
                if element.on_click.is_empty() {
                    errors.push("buttonGroup element onClick must not be empty".into());
                }
                validate_click_effects(Some(&element.on_click), errors);
                validate_condition(element.active_when.as_ref(), "activeWhen", errors);
                validate_condition(element.enabled_when.as_ref(), "enabledWhen", errors);
            }
        }
    }
}

fn validate_node_style(style: Option<&NodeStyle>, field: &str, errors: &mut Vec<String>) {
    let Some(style) = style else {
        return;
    };
    if let Some(size) = style.font_size {
        if size <= 0.0 {
            errors.push(format!("{field}.fontSize must be greater than 0"));
        }
    }
    if let Some(weight) = &style.font_weight {
        match weight {
            FontWeight::Keyword(keyword) if keyword == "normal" || keyword == "bold" => {}
            FontWeight::Number(n) if (100..=900).contains(n) => {}
            FontWeight::Keyword(keyword) => {
                errors.push(format!(
                    "{field}.fontWeight \"{keyword}\" must be normal, bold, or 100–900"
                ));
            }
            FontWeight::Number(n) => {
                errors.push(format!(
                    "{field}.fontWeight {n} must be between 100 and 900"
                ));
            }
        }
    }
    if let Some(align) = &style.text_align {
        if !matches!(align.as_str(), "left" | "center" | "right") {
            errors.push(format!(
                "{field}.textAlign \"{align}\" must be left, center, or right"
            ));
        }
    }
}

fn view_layout_style(layout: &ViewLayout) -> Option<&NodeStyle> {
    match layout {
        ViewLayout::Canvas(f) => f.style.as_ref(),
        ViewLayout::Row(f) | ViewLayout::Column(f) => f.style.as_ref(),
    }
}

fn layout_node_style(node: &LayoutNode) -> Option<&NodeStyle> {
    match node {
        LayoutNode::Row(f) | LayoutNode::Column(f) | LayoutNode::Overlay(f) => f.style.as_ref(),
        LayoutNode::Subview(f) => f.style.as_ref(),
        LayoutNode::Decoration(f) => f.style.as_ref(),
        LayoutNode::Button(f)
        | LayoutNode::Seekbar(f)
        | LayoutNode::Artwork(f)
        | LayoutNode::Transport(f)
        | LayoutNode::Visualizer(f)
        | LayoutNode::Volume(f)
        | LayoutNode::Balance(f)
        | LayoutNode::Time(f) => f.style.as_ref(),
        LayoutNode::EqBand(f) => f.control.style.as_ref(),
        LayoutNode::ButtonGroup(f) => f.style.as_ref(),
        LayoutNode::Text(f) => f.style.as_ref(),
        LayoutNode::Playlist(f) => f.style.as_ref(),
        LayoutNode::TiledFrame(f) => f.style.as_ref(),
        LayoutNode::Slideshow(f) => f.style.as_ref(),
        LayoutNode::ScrollStrip(f) => f.style.as_ref(),
    }
}

fn validate_bounds(bounds: &LayoutBounds, field: &str, errors: &mut Vec<String>) {
    match (bounds.x, bounds.right, bounds.w) {
        (None, None, _) => errors.push(format!("{field} must set x or right")),
        (Some(_), Some(_), Some(_)) => errors.push(format!(
            "{field}: when both x and right are set, omit w (horizontal stretch)"
        )),
        (Some(_), None, None) | (None, Some(_), None) => errors.push(format!(
            "{field}: set w, or both x and right for horizontal stretch"
        )),
        (_, _, Some(w)) if w <= 0.0 => {
            errors.push(format!("{field}.w must be positive"));
        }
        _ => {}
    }

    match (bounds.y, bounds.bottom, bounds.h) {
        (None, None, _) => errors.push(format!("{field} must set y or bottom")),
        (Some(_), Some(_), Some(_)) => errors.push(format!(
            "{field}: when both y and bottom are set, omit h (vertical stretch)"
        )),
        (Some(_), None, None) | (None, Some(_), None) => errors.push(format!(
            "{field}: set h, or both y and bottom for vertical stretch"
        )),
        (_, _, Some(h)) if h <= 0.0 => {
            errors.push(format!("{field}.h must be positive"));
        }
        _ => {}
    }
}

fn validate_view_layout(layout: &ViewLayout, pack_dir: &Path, errors: &mut Vec<String>) {
    validate_node_style(view_layout_style(layout), "style", errors);
    match layout {
        ViewLayout::Canvas(f) => {
            if f.width == 0 || f.height == 0 {
                errors.push("canvas root width and height must be at least 1".into());
            }
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            for child in &f.children {
                validate_layout_node(child, pack_dir, errors);
            }
        }
        ViewLayout::Row(f) | ViewLayout::Column(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            for child in &f.children {
                validate_layout_node(child, pack_dir, errors);
            }
        }
    }
}

fn validate_layout_node(node: &LayoutNode, pack_dir: &Path, errors: &mut Vec<String>) {
    validate_node_style(layout_node_style(node), "style", errors);
    match node {
        LayoutNode::Row(f) | LayoutNode::Column(f) | LayoutNode::Overlay(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            for child in &f.children {
                validate_layout_node(child, pack_dir, errors);
            }
        }
        LayoutNode::Subview(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            validate_bounds(&f.bounds, "bounds", errors);
            for child in &f.children {
                validate_layout_node(child, pack_dir, errors);
            }
        }
        LayoutNode::Decoration(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_presentation(&f.presentation, pack_dir, errors);
        }
        LayoutNode::Button(f)
        | LayoutNode::Seekbar(f)
        | LayoutNode::Artwork(f)
        | LayoutNode::Transport(f)
        | LayoutNode::Visualizer(f)
        | LayoutNode::Volume(f)
        | LayoutNode::Balance(f)
        | LayoutNode::Time(f) => {
            validate_click_effects(f.on_click.as_deref(), errors);
            validate_bind(f.bind.as_deref(), "bind", errors);
            validate_condition(f.enabled_when.as_ref(), "enabledWhen", errors);
            validate_condition(f.active_when.as_ref(), "activeWhen", errors);
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_presentation(&f.presentation, pack_dir, errors);
        }
        LayoutNode::Playlist(f) => {
            validate_node_style(f.playing_row_style.as_ref(), "playingRowStyle", errors);
            validate_node_style(f.current_row_style.as_ref(), "currentRowStyle", errors);
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            if let Some(source) = &f.default_source {
                if source != "all" && source != "upNext" {
                    errors.push(format!(
                        "playlist defaultSource \"{source}\" must be all or upNext"
                    ));
                }
            }
        }
        LayoutNode::EqBand(f) => {
            if !(1..=10).contains(&f.band) {
                errors.push(format!(
                    "eqBand band must be between 1 and 10, got {}",
                    f.band
                ));
            }
            validate_click_effects(f.control.on_click.as_deref(), errors);
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
        }
        LayoutNode::TiledFrame(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_tiled_frame_presentation(&f.presentation, pack_dir, errors);
            for child in &f.children {
                validate_layout_node(child, pack_dir, errors);
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
        validate_lifecycle_effects(view.on_activate.as_deref(), &mut errors);
        validate_view_layout(&view.layout, pack_dir, &mut errors);
    }

    let primary_count = manifest
        .views
        .values()
        .filter(|view| view.presentation.as_deref() == Some("primary"))
        .count();
    let view_count = manifest.views.len();
    if view_count == 1 {
        if let Some((view_name, view)) = manifest.views.iter().next() {
            if let Some(presentation) = &view.presentation {
                if presentation != "primary" {
                    errors.push(format!(
                        "views.{view_name}.presentation \"{presentation}\" is not valid on a single-view skin (omit presentation or use primary)"
                    ));
                }
            }
        }
    } else if view_count >= 2 && primary_count == 0 {
        errors.push(
            "skins with two or more views must declare exactly one view with presentation \"primary\""
                .into(),
        );
    }
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

    fn write_skin_json(stem: &str, body: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "spk-skin-{stem}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("skin.json");
        let mut f = std::fs::File::create(&path).unwrap();
        write!(f, "{body}").unwrap();
        (dir, path)
    }

    #[test]
    fn rejects_missing_skin_name() {
        let (dir, path) = write_skin_json(
            "bad-name",
            r#"{"name":"","author":"a","description":"","views":{"main":{"layout":{"type":"canvas","width":100,"height":80,"children":[]}}}}"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("name") || err.contains("layout") || !err.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_playlist_default_source_up_next() {
        let (dir, path) = write_skin_json(
            "playlist-default",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[
                      {
                        "type":"playlist",
                        "defaultSource":"upNext"
                      }
                    ]
                  }
                }
              }
            }"#,
        );
        validate_skin_contribution_at(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unknown_playlist_default_source() {
        let (dir, path) = write_skin_json(
            "playlist-bad-source",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                      "type":"playlist",
                      "defaultSource":"library"
                    }]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("defaultSource"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_queue_node_type() {
        let (dir, path) = write_skin_json(
            "queue-node",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"queue",
                    "action":"queue.openSetList",
                    "presentation":{"kind":"primitive"}
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("valid skin JSON") || err.contains("queue"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_primitive_library_icon_and_ghost_variant() {
        let (dir, path) = write_skin_json(
            "primitive-library-icon",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                    "type":"button",
                    "onClick":[{"action":"skin.openPicker"}],
                    "presentation":{"kind":"primitive","icon":"setList","variant":"ghost"}
                    }]
                  }
                }
              }
            }"#,
        );
        validate_skin_contribution_at(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_primitive_plain_variant() {
        let (dir, path) = write_skin_json(
            "primitive-plain-variant",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                    "type":"button",
                    "onClick":[{"action":"eq.reset"}],
                    "presentation":{"kind":"primitive","text":"reset","variant":"plain"}
                    }]
                  }
                }
              }
            }"#,
        );
        validate_skin_contribution_at(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_missing_primitive_asset_icon() {
        let (dir, path) = write_skin_json(
            "primitive-missing-asset",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                    "type":"button",
                    "onClick":[{"action":"skin.openPicker"}],
                    "presentation":{"kind":"primitive","icon":"icons/missing.png"}
                    }]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("primitive icon") || err.contains("not found"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_invalid_primitive_variant() {
        let (dir, path) = write_skin_json(
            "primitive-bad-variant",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                    "type":"button",
                    "onClick":[{"action":"skin.openPicker"}],
                    "presentation":{"kind":"primitive","variant":"playlist"}
                    }]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("variant"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_malformed_primitive_icon_id() {
        let (dir, path) = write_skin_json(
            "primitive-bad-icon-id",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                    "type":"button",
                    "onClick":[{"action":"skin.openPicker"}],
                    "presentation":{"kind":"primitive","icon":"Set-List"}
                    }]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("primitive icon"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_text_node_with_partial_style_and_no_presentation() {
        let (dir, path) = write_skin_json(
            "text-partial-style",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                    "type":"text",
                    "bind":"track.title",
                    "style":{"color":"white","fontSize":8,"textAlign":"center"}
                    }]
                  }
                }
              }
            }"#,
        );
        validate_skin_contribution_at(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_text_node_without_presentation() {
        let (dir, path) = write_skin_json(
            "text-no-presentation",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                    "type":"text",
                    "bind":"track.title"
                    }]
                  }
                }
              }
            }"#,
        );
        validate_skin_contribution_at(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_text_node_with_presentation() {
        let (dir, path) = write_skin_json(
            "text-with-presentation",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                    "type":"text",
                    "bind":"track.title",
                    "presentation":{"kind":"primitive"}
                    }]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(
            err.contains("presentation") || err.contains("valid skin JSON"),
            "unexpected error: {err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unknown_style_key() {
        let (dir, path) = write_skin_json(
            "unknown-style-key",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                    "type":"text",
                    "bind":"track.title",
                    "style":{"color":"white","letterSpacing":1}
                    }]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(
            err.contains("letterSpacing") || err.contains("valid skin JSON"),
            "unexpected error: {err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_non_positive_font_size() {
        let (dir, path) = write_skin_json(
            "bad-font-size",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                    "type":"text",
                    "style":{"fontSize":0}
                    }]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("fontSize"), "unexpected error: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_invalid_text_align() {
        let (dir, path) = write_skin_json(
            "bad-text-align",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                    "type":"text",
                    "style":{"textAlign":"justify"}
                    }]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("textAlign"), "unexpected error: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_playlist_playing_row_style() {
        let (dir, path) = write_skin_json(
            "playlist-playing-row-style",
            r##"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"canvas",
                    "width":100,
                    "height":80,
                    "children":[{
                      "type":"playlist",
                      "id":"pl-list",
                      "style":{"backgroundColor":"#000000","color":"#7ec509","fontSize":11},
                      "playingRowStyle":{"color":"#ffffff","backgroundColor":"#369108"}
                    }]
                  }
                }
              }
            }"##,
        );
        validate_skin_contribution_at(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unknown_playing_row_style_key() {
        let (dir, path) = write_skin_json(
            "unknown-playing-row-style-key",
            r##"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"canvas",
                    "width":100,
                    "height":80,
                    "children":[{
                      "type":"playlist",
                      "playingRowStyle":{"color":"#fff","letterSpacing":1}
                    }]
                  }
                }
              }
            }"##,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(
            err.contains("letterSpacing") || err.contains("valid skin JSON"),
            "unexpected error: {err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_playlist_current_row_style() {
        let (dir, path) = write_skin_json(
            "playlist-current-row-style",
            r##"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"canvas",
                    "width":100,
                    "height":80,
                    "children":[{
                      "type":"playlist",
                      "id":"pl-view",
                      "style":{"fontSize":11},
                      "currentRowStyle":{"color":"#d7ff9a"}
                    }]
                  }
                }
              }
            }"##,
        );
        validate_skin_contribution_at(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unknown_current_row_style_key() {
        let (dir, path) = write_skin_json(
            "unknown-current-row-style-key",
            r##"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"canvas",
                    "width":100,
                    "height":80,
                    "children":[{
                      "type":"playlist",
                      "currentRowStyle":{"color":"#d7ff9a","letterSpacing":1}
                    }]
                  }
                }
              }
            }"##,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(
            err.contains("letterSpacing") || err.contains("valid skin JSON"),
            "unexpected error: {err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preserves_button_sound_when() {
        let (dir, path) = write_skin_json(
            "sound-when",
            r#"{
              "name":"T3",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"canvas",
                    "width":10,
                    "height":10,
                    "children":[{
                      "type":"button",
                      "onClick":[{"action":"view.applyStateEvent"}],
                      "soundWhen":{
                        "view.shutter.intro":"open",
                        "view.shutter.open":"close"
                      },
                      "presentation":{
                        "kind":"bitmap",
                        "width":1,
                        "height":1,
                        "assets":{"default":"b.png"}
                      }
                    }]
                  }
                }
              }
            }"#,
        );
        let manifest = read_skin_manifest(&path).unwrap();
        let ViewLayout::Canvas(canvas) = &manifest.views["main"].layout else {
            panic!("expected canvas");
        };
        let LayoutNode::Button(button) = &canvas.children[0] else {
            panic!("expected button");
        };
        let sound_when = button.sound_when.as_ref().expect("soundWhen dropped");
        assert_eq!(
            sound_when.get("view.shutter.intro").map(String::as_str),
            Some("open")
        );
        assert_eq!(
            sound_when.get("view.shutter.open").map(String::as_str),
            Some("close")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_sound_on_click_effect() {
        let (dir, path) = write_skin_json(
            "onclick-sound",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                      "type":"button",
                      "onClick":[{"action":"skin.openPicker","sound":"button"}],
                      "presentation":{"kind":"primitive"}
                    }]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(
            err.contains("sound") || err.contains("valid skin JSON"),
            "unexpected error: {err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preserves_view_state_transition() {
        let (dir, path) = write_skin_json(
            "view-state-transition",
            r#"{
              "name":"Headspace",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"canvas",
                    "width":10,
                    "height":10,
                    "children":[]
                  },
                  "state":{
                    "eq":{
                      "default":"closed",
                      "on":{
                        "toggle":[{
                          "from":["closed"],
                          "set":"open"
                        }]
                      }
                    }
                  }
                }
              }
            }"#,
        );
        let manifest = read_skin_manifest(&path).unwrap();
        let spec = &manifest.views["main"].state.as_ref().unwrap()["eq"];
        let branch = &spec.on.as_ref().unwrap()["toggle"][0];
        assert_eq!(
            branch.from.as_ref().unwrap(),
            &vec![serde_json::json!("closed")]
        );
        assert_eq!(branch.set, serde_json::json!("open"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_exclusive_on_single_view() {
        let (dir, path) = write_skin_json(
            "single-exclusive",
            r#"{
              "name":"Vanilla",
              "author":"a",
              "description":"",
              "views":{
                "mini":{
                  "presentation":"exclusive",
                  "layout":{"type":"canvas","width":100,"height":80,"children":[]}
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("single-view"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_multi_view_without_primary() {
        let (dir, path) = write_skin_json(
            "multi-no-primary",
            r#"{
              "name":"T3",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "layout":{"type":"canvas","width":100,"height":80,"children":[]}
                },
                "mini":{
                  "presentation":"exclusive",
                  "layout":{"type":"canvas","width":50,"height":40,"children":[]}
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("primary"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_multi_view_with_one_primary() {
        let (dir, path) = write_skin_json(
            "multi-primary",
            r#"{
              "name":"T3",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "presentation":"primary",
                  "layout":{"type":"canvas","width":100,"height":80,"children":[]}
                },
                "mini":{
                  "presentation":"exclusive",
                  "layout":{"type":"canvas","width":50,"height":40,"children":[]}
                }
              }
            }"#,
        );
        validate_skin_contribution_at(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_two_primary_views() {
        let (dir, path) = write_skin_json(
            "two-primary",
            r#"{
              "name":"T3",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "presentation":"primary",
                  "layout":{"type":"canvas","width":100,"height":80,"children":[]}
                },
                "mini":{
                  "presentation":"primary",
                  "layout":{"type":"canvas","width":50,"height":40,"children":[]}
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("exactly one"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
