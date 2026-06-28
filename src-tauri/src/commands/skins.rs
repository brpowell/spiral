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
#[serde(rename_all = "camelCase")]
pub struct SkinViewActivateEffect {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<String>,
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
    pub bounds_when: Option<HashMap<String, LayoutBoundsOverride>>,
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
    pub bounds_when: Option<HashMap<String, LayoutBoundsOverride>>,
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
    pub bounds_when: Option<HashMap<String, LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag_region: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitAreaFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub bounds: LayoutBounds,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<HashMap<String, LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<String>,
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
pub struct TiledFramePresentation {
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
    pub presentation: TiledFramePresentation,
    pub children: Vec<LayoutNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<String>,
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
    pub active_when: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled_when: Option<String>,
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
    pub presentation: Presentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<HashMap<String, LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<String>,
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
    pub presentation: SlideshowPresentation,
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
    pub panel_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled_when: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_when: Option<String>,
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
    pub visible_when: Option<String>,
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
    pub bind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
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
    Gif {
        asset_base: String,
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
    #[serde(rename = "bitmapSeekbar", rename_all = "camelCase")]
    BitmapSeekbar {
        track: String,
        fill: String,
        thumb: String,
        border_size: f64,
        track_width: f64,
        track_height: f64,
        thumb_width: f64,
        thumb_height: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        class_prefix: Option<String>,
    },
    #[serde(rename = "bitmapVerticalSlider", rename_all = "camelCase")]
    BitmapVerticalSlider {
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fill_from_bottom: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        class_prefix: Option<String>,
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sound: Option<String>,
        elements: Vec<ButtonGroupElement>,
    },
    #[serde(rename = "framedPanel", rename_all = "camelCase")]
    FramedPanel {
        mask: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        frame: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_inset: Option<FramedPanelInset>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        class_prefix: Option<String>,
    },
    #[serde(rename = "compact", rename_all = "camelCase")]
    Compact {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        show_dropdown: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        show_duration: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        class_prefix: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<String>,
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
        if is_known_view_bind(p) || is_known_slideshow_bind(p) {
            return;
        }
        errors.push(format!(
            "{field} references unknown bind path \"{p}\". See skin-contract.md for valid paths."
        ));
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
    track: &str,
    thumb: &str,
    track_tile_width: &f64,
    track_tile_height: &f64,
    track_width: &f64,
    track_height: &f64,
    thumb_width: &f64,
    thumb_height: &f64,
    border_size: &Option<f64>,
    pack_dir: &Path,
    errors: &mut Vec<String>,
) {
    for (label, path) in [("track", track), ("thumb", thumb)] {
        if path.contains("..") || path.starts_with('/') {
            errors.push(format!(
                "{kind} {label} \"{path}\" must be a relative path under assets/"
            ));
            return;
        }
        let base = pack_dir.join("assets").join(path);
        let found = ["png", "webp", "jpg", "jpeg"]
            .iter()
            .any(|ext| base.with_extension(ext).is_file());
        if !found {
            errors.push(format!(
                "{kind} {label} asset not found: expected {}.(png|webp|jpg)",
                base.display()
            ));
        }
    }
    if track_tile_width <= &0.0 || track_tile_height <= &0.0 {
        errors.push(format!(
            "{kind} trackTileWidth and trackTileHeight must be positive"
        ));
    }
    if track_width <= &0.0 || track_height <= &0.0 {
        errors.push(format!("{kind} trackWidth and trackHeight must be positive"));
    }
    if thumb_width <= &0.0 || thumb_height <= &0.0 {
        errors.push(format!("{kind} thumbWidth and thumbHeight must be positive"));
    }
    if border_size.is_some_and(|size| size < 0.0) {
        errors.push(format!("{kind} borderSize must be non-negative"));
    }
}

fn validate_tiled_frame_asset(path: &str, pack_dir: &Path, label: &str, errors: &mut Vec<String>) {
    if path.contains("..") || path.starts_with('/') {
        errors.push(format!(
            "tiledFrame {label} \"{path}\" must be a relative path under assets/"
        ));
        return;
    }
    let base = pack_dir.join("assets").join(path);
    let found = ["png", "webp", "jpg", "jpeg"]
        .iter()
        .any(|ext| base.with_extension(ext).is_file());
    if !found {
        errors.push(format!(
            "tiledFrame {label} asset not found: expected {}.(png|webp|jpg)",
            base.display()
        ));
    }
}

fn validate_tiled_frame_presentation(
    presentation: &TiledFramePresentation,
    pack_dir: &Path,
    errors: &mut Vec<String>,
) {
    if presentation.kind != "tiledFrame" {
        errors.push(format!(
            "tiledFrame presentation kind must be \"tiledFrame\", got \"{}\"",
            presentation.kind
        ));
    }
    if presentation.frame_thickness <= 0.0 {
        errors.push("tiledFrame frameThickness must be positive".to_string());
    }
    let assets = &presentation.assets;
    validate_tiled_frame_asset(&assets.top_left, pack_dir, "assets.topLeft", errors);
    validate_tiled_frame_asset(&assets.top_center, pack_dir, "assets.topCenter", errors);
    validate_tiled_frame_asset(&assets.top_right, pack_dir, "assets.topRight", errors);
    validate_tiled_frame_asset(&assets.top_stretch, pack_dir, "assets.topStretch", errors);
    validate_tiled_frame_asset(&assets.left_stretch, pack_dir, "assets.leftStretch", errors);
    validate_tiled_frame_asset(&assets.right_stretch, pack_dir, "assets.rightStretch", errors);
    validate_tiled_frame_asset(&assets.bottom_left, pack_dir, "assets.bottomLeft", errors);
    validate_tiled_frame_asset(&assets.bottom_center, pack_dir, "assets.bottomCenter", errors);
    validate_tiled_frame_asset(&assets.bottom_right, pack_dir, "assets.bottomRight", errors);
    validate_tiled_frame_asset(&assets.bottom_stretch, pack_dir, "assets.bottomStretch", errors);
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
        Presentation::Gif {
            asset_base,
            complete_action,
            ..
        } => {
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
            validate_action(complete_action.as_deref(), errors);
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
        Presentation::BitmapSeekbar {
            track,
            fill,
            thumb,
            border_size,
            track_width,
            track_height,
            thumb_width,
            thumb_height,
            ..
        } => {
            for (label, path) in [
                ("track", track.as_str()),
                ("fill", fill.as_str()),
                ("thumb", thumb.as_str()),
            ] {
                if path.contains("..") || path.starts_with('/') {
                    errors.push(format!(
                        "bitmapSeekbar {label} \"{path}\" must be a relative path under assets/"
                    ));
                    return;
                }
                let base = pack_dir.join("assets").join(path);
                let found = ["png", "webp", "jpg", "jpeg"]
                    .iter()
                    .any(|ext| base.with_extension(ext).is_file());
                if !found {
                    errors.push(format!(
                        "bitmapSeekbar {label} asset not found: expected {}.(png|webp|jpg)",
                        base.display()
                    ));
                }
            }
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
                track,
                thumb,
                track_tile_width,
                track_tile_height,
                track_width,
                track_height,
                thumb_width,
                thumb_height,
                border_size,
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
                track,
                thumb,
                track_tile_width,
                track_tile_height,
                track_width,
                track_height,
                thumb_width,
                thumb_height,
                border_size,
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
        Presentation::FramedPanel {
            mask,
            frame,
            content_inset,
            ..
        } => {
            for (label, path) in [("mask", mask.as_str())]
                .into_iter()
                .chain(frame.as_deref().map(|p| ("frame", p)))
            {
                if path.contains("..") || path.starts_with('/') {
                    errors.push(format!(
                        "framedPanel {label} \"{path}\" must be a relative path under assets/"
                    ));
                    return;
                }
                let base = pack_dir.join("assets").join(path);
                let found = ["png", "webp", "jpg", "jpeg"]
                    .iter()
                    .any(|ext| base.with_extension(ext).is_file());
                if !found {
                    errors.push(format!(
                        "framedPanel {label} asset not found: expected {}.(png|webp|jpg)",
                        base.display()
                    ));
                }
            }
            if let Some(inset) = content_inset {
                if inset.w <= 0.0 || inset.h <= 0.0 {
                    errors.push("framedPanel contentInset.w and contentInset.h must be positive".into());
                }
            }
        }
        Presentation::Compact { .. } => {}
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
                validate_bind(element.active_when.as_deref(), "activeWhen", errors);
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
        LayoutNode::HitArea(f) => {
            validate_bind(f.visible_when.as_deref(), "visibleWhen", errors);
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
            validate_bind(f.disabled_when.as_deref(), "disabledWhen", errors);
            validate_bind(f.active_when.as_deref(), "activeWhen", errors);
            validate_bind(f.visible_when.as_deref(), "visibleWhen", errors);
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
            validate_bind(f.control.disabled_when.as_deref(), "disabledWhen", errors);
            validate_bind(f.control.visible_when.as_deref(), "visibleWhen", errors);
            if let Some(bounds) = &f.control.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_presentation(&f.control.presentation, pack_dir, errors);
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
        LayoutNode::TiledFrame(f) => {
            validate_bind(f.visible_when.as_deref(), "visibleWhen", errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_tiled_frame_presentation(&f.presentation, pack_dir, errors);
            for child in &f.children {
                validate_layout_node(child, pack_dir, errors);
            }
        }
        LayoutNode::Slideshow(f) => {
            validate_bind(f.visible_when.as_deref(), "visibleWhen", errors);
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

    #[test]
    fn t3_mini_switch_preserves_view_id() {
        let pack_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("skins/builtin/t3");
        let pack = load_pack_from_dir(&pack_dir, true).expect("t3 skin should load");
        let main = &pack.manifest.views["main"];
        let mini_switch = find_control_by_id(&main.layout, "mini-switch")
            .expect("main view should include mini-switch button");
        assert_eq!(mini_switch.view_id.as_deref(), Some("mini"));
    }

    fn find_control_by_id<'a>(node: &'a LayoutNode, id: &str) -> Option<&'a ControlFields> {
        match node {
            LayoutNode::Button(f) | LayoutNode::Seekbar(f) | LayoutNode::Artwork(f)
            | LayoutNode::Transport(f) | LayoutNode::Visualizer(f) | LayoutNode::Volume(f)
            | LayoutNode::Balance(f) | LayoutNode::Queue(f) | LayoutNode::Time(f)
            | LayoutNode::Playlist(f) if f.id.as_deref() == Some(id) => Some(f),
            LayoutNode::Stack(f) | LayoutNode::Row(f) | LayoutNode::Column(f)
            | LayoutNode::Overlay(f) | LayoutNode::Canvas(f) => f
                .children
                .iter()
                .find_map(|child| find_control_by_id(child, id)),
            LayoutNode::Region(f) => f
                .children
                .iter()
                .find_map(|child| find_control_by_id(child, id)),
            LayoutNode::TiledFrame(f) => f
                .children
                .iter()
                .find_map(|child| find_control_by_id(child, id)),
            _ => None,
        }
    }
}
