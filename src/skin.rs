//! Skin contribution types and validation (`skin.json`).

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

const KNOWN_ACTIONS: &[&str] = &[
    "player.togglePlayPause",
    "player.play",
    "player.pause",
    "player.stop",
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
    "skin.togglePref",
    "skin.setPref",
    "visualizer.previous",
    "visualizer.next",
    "playlist.setSource",
    "playlist.playTrack",
    "playlist.setFilter",
    "eq.setBand",
    "eq.applyPreset",
    "eq.reset",
    "eq.setEnabled",
    "eq.previousPreset",
    "eq.nextPreset",
    "app.quit",
    "app.openUrl",
    "app.openFile",
    "state.setVariable",
    "state.applyEvent",
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
    "track.rating",
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
    "playlist.filterQuery",
    "playlist.hasFilter",
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

const BUILTIN_SKIN_PREF_IDS: &[&str] = &["soundEffectsEnabled"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkinSetting {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub setting_type: String,
    pub default: serde_json::Value,
}

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<Vec<SkinSetting>>,
}

struct SkinValidationCtx<'a> {
    declared_pref_ids: &'a HashSet<String>,
}

impl SkinValidationCtx<'_> {
    fn is_known_skin_pref(&self, id: &str) -> bool {
        BUILTIN_SKIN_PREF_IDS.contains(&id) || self.declared_pref_ids.contains(id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SkinCondition {
    Bool(bool),
    Leaf(String),
    All { all: Vec<SkinCondition> },
    Any { any: Vec<SkinCondition> },
    Not { not: Box<SkinCondition> },
}

impl SkinCondition {
    fn validate_leaves(&self, field: &str, ctx: &SkinValidationCtx<'_>, errors: &mut Vec<String>) {
        match self {
            SkinCondition::Bool(_) => {}
            SkinCondition::Leaf(path) => {
                validate_bind(Some(path.as_str()), field, ctx, errors);
            }
            SkinCondition::All { all } => {
                for child in all {
                    child.validate_leaves(field, ctx, errors);
                }
            }
            SkinCondition::Any { any } => {
                for child in any {
                    child.validate_leaves(field, ctx, errors);
                }
            }
            SkinCondition::Not { not } => not.validate_leaves(field, ctx, errors),
        }
    }
}

/// Bind map or ordered `{ when, …overlay }` list. Last match wins.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OverlayWhen<T> {
    Map(HashMap<String, T>),
    List(Vec<WhenOverlay<T>>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhenOverlay<T> {
    pub when: SkinCondition,
    #[serde(flatten)]
    pub overlay: T,
}

impl<T> OverlayWhen<T> {
    fn validate(
        &self,
        field: &str,
        ctx: &SkinValidationCtx<'_>,
        errors: &mut Vec<String>,
        mut validate_overlay: impl FnMut(&T, &str, &mut Vec<String>),
    ) {
        match self {
            OverlayWhen::Map(map) => {
                for (path, overlay) in map {
                    validate_bind(Some(path.as_str()), field, ctx, errors);
                    validate_overlay(overlay, &format!("{field}.{path}"), errors);
                }
            }
            OverlayWhen::List(rows) => {
                for (index, row) in rows.iter().enumerate() {
                    row.when
                        .validate_leaves(&format!("{field}[{index}].when"), ctx, errors);
                    validate_overlay(&row.overlay, &format!("{field}[{index}]"), errors);
                }
            }
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound: Option<String>,
}

pub type SkinLifecycleEffect = SkinClickEffect;

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
    /// Same object as node `transition`. Reserved for the host interpolator;
    /// today's CSS path reads `transition` on the layout node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<LayoutTransition>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_when: Option<OverlayWhen<NodeStyle>>,
    pub width: u32,
    pub height: u32,
    pub children: Vec<LayoutNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag_region: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<LayoutTransition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_when: Option<OverlayWhen<LayoutTransition>>,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutTransition {
    pub duration_ms: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub easing: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
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
    #[serde(rename = "text")]
    Text(TextControlFields),
    #[serde(rename = "input")]
    Input(InputControlFields),
    #[serde(rename = "artwork")]
    Artwork(ControlFields),
    #[serde(rename = "transport")]
    Transport(ControlFields),
    #[serde(rename = "visualizer")]
    Visualizer(ControlFields),
    #[serde(rename = "rating")]
    Rating(ControlFields),
    #[serde(rename = "slider")]
    Slider(SliderFields),
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_when: Option<OverlayWhen<NodeStyle>>,
    pub children: Vec<LayoutNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z_index: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<OverlayWhen<LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag_region: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<LayoutTransition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_when: Option<OverlayWhen<LayoutTransition>>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_when: Option<OverlayWhen<NodeStyle>>,
    pub bounds: LayoutBounds,
    pub children: Vec<LayoutNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<OverlayWhen<LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passthrough: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag_region: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<LayoutTransition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_when: Option<OverlayWhen<LayoutTransition>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_hover_leave: Option<Vec<SkinClickEffect>>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_when: Option<OverlayWhen<NodeStyle>>,
    pub presentation: Presentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<OverlayWhen<LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag_region: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<LayoutTransition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_when: Option<OverlayWhen<LayoutTransition>>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_corner_radius: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TiledFramePresetPresentation {
    pub kind: String,
    pub assets: TiledFrameAssets,
    pub tile_sizes: TiledFrameTileSizes,
    pub frame_thickness: f64,
    pub content_inset: TiledFrameContentInset,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_corner_radius: Option<f64>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_when: Option<OverlayWhen<NodeStyle>>,
    pub presentation: TiledFramePresentation,
    pub children: Vec<LayoutNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<LayoutTransition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_when: Option<OverlayWhen<LayoutTransition>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonGroupElement {
    pub mapping_color: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_when: Option<OverlayWhen<NodeStyle>>,
    pub presentation: Presentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<OverlayWhen<LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<LayoutTransition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_when: Option<OverlayWhen<LayoutTransition>>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_when: Option<OverlayWhen<NodeStyle>>,
    pub presentation: SlideshowPresentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<LayoutTransition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_when: Option<OverlayWhen<LayoutTransition>>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_when: Option<OverlayWhen<NodeStyle>>,
    pub presentation: ScrollStripPresentation,
    pub bounds: LayoutBounds,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<LayoutTransition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_when: Option<OverlayWhen<LayoutTransition>>,
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
    pub style_when: Option<OverlayWhen<NodeStyle>>,
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
    pub bounds_when: Option<OverlayWhen<LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    /// Artwork only: CSS `object-fit`. Validated in `validate_layout_node`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_fit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<LayoutTransition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_when: Option<OverlayWhen<LayoutTransition>>,
}

/// What a slider writes. Omit for decorative/unbound thumbs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SliderControl {
    Volume,
    Seek,
    Balance,
    Eq,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SliderFields {
    /// Host write path. Omit for decorative/unbound thumbs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub control: Option<SliderControl>,
    /// 1-based EQ band (required when `control` is `Eq`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub band: Option<u8>,
    /// Linear tilt control point when `control` is `Eq`. All `spread: "linear"`
    /// eq sliders in the skin are endpoints; dragging one interpolates the other bands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spread: Option<String>,
    #[serde(flatten)]
    pub base: ControlFields,
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
    pub style_when: Option<OverlayWhen<NodeStyle>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overflow: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<OverlayWhen<LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<LayoutTransition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_when: Option<OverlayWhen<LayoutTransition>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InputControlFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<NodeStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_when: Option<OverlayWhen<NodeStyle>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_length: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_change: Option<Vec<SkinClickEffect>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<LayoutBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_when: Option<OverlayWhen<LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<LayoutTransition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_when: Option<OverlayWhen<LayoutTransition>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveAssets {
    pub default: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hover: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pressed: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled: Option<String>,
}

/// Slider thumb sprite set (`default` / `hover` / `pressed`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbAssets {
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
    #[serde(rename = "bitmapVerticalSlider", rename_all = "camelCase")]
    BitmapVerticalSlider {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        track: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fill: Option<String>,
        thumb: ThumbAssets,
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
    #[serde(rename = "bitmapHorizontalSlider", rename_all = "camelCase")]
    BitmapHorizontalSlider {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        track: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fill: Option<String>,
        thumb: ThumbAssets,
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
    pub style_when: Option<OverlayWhen<NodeStyle>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playing_row_style: Option<NodeStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_row_style: Option<NodeStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_style: Option<NodeStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_hover_style: Option<NodeStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_hover_style: Option<NodeStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items: Option<String>,
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
    pub bounds_when: Option<OverlayWhen<LayoutBoundsOverride>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_when: Option<SkinCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<LayoutTransition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_when: Option<OverlayWhen<LayoutTransition>>,
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

fn validate_condition(
    condition: Option<&SkinCondition>,
    field: &str,
    ctx: &SkinValidationCtx<'_>,
    errors: &mut Vec<String>,
) {
    if let Some(cond) = condition {
        cond.validate_leaves(field, ctx, errors);
    }
}

fn validate_bind(
    path: Option<&str>,
    field: &str,
    ctx: &SkinValidationCtx<'_>,
    errors: &mut Vec<String>,
) {
    if let Some(p) = path {
        if KNOWN_BINDS.contains(&p) {
            return;
        }
        if p.starts_with("skin.pref.") {
            let suffix = p.strip_prefix("skin.pref.").unwrap_or("");
            if !suffix.is_empty() && !suffix.contains('.') && ctx.is_known_skin_pref(suffix) {
                return;
            }
            if !suffix.is_empty() && !suffix.contains('.') {
                errors.push(format!(
                    "{field} references unknown skin preference \"{suffix}\"."
                ));
                return;
            }
        }
        if is_known_state_bind(p)
            || is_known_slideshow_bind(p)
            || is_known_scroll_strip_bind(p)
            || is_known_hover_bind(p)
            || is_known_input_bind(p)
        {
            return;
        }
        errors.push(format!("{field} references unknown bind path \"{p}\"."));
    }
}

fn is_known_hover_bind(path: &str) -> bool {
    let Some(id) = path.strip_prefix("hover.") else {
        return false;
    };
    !id.is_empty() && !id.contains('.')
}

fn is_known_input_bind(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("input.") else {
        return false;
    };
    let Some((id, prop)) = rest.split_once('.') else {
        return false;
    };
    !id.is_empty() && !id.contains('.') && matches!(prop, "value" | "empty")
}

const RESERVED_STATE_VARIABLE_IDS: &[&str] = &["setVariable", "applyEvent"];

fn is_known_state_bind(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("state.") else {
        return false;
    };
    let parts: Vec<&str> = rest.split('.').collect();
    match parts.as_slice() {
        [var] if RESERVED_STATE_VARIABLE_IDS.contains(var) => false,
        [var] => !var.is_empty(),
        [var, _] if RESERVED_STATE_VARIABLE_IDS.contains(var) => false,
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
    if let Some(disabled) = &assets.disabled {
        validate_skin_asset_file(disabled, pack_dir, &format!("{label}.disabled"), errors);
    }
}

fn validate_interactive_assets_when(
    assets_when: &HashMap<String, InteractiveAssets>,
    pack_dir: &Path,
    label: &str,
    ctx: &SkinValidationCtx<'_>,
    errors: &mut Vec<String>,
) {
    for (bind, assets) in assets_when {
        validate_bind(
            Some(bind.as_str()),
            &format!("{label}.assetsWhen"),
            ctx,
            errors,
        );
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

fn validate_click_effects(
    effects: Option<&[SkinClickEffect]>,
    ctx: &SkinValidationCtx<'_>,
    errors: &mut Vec<String>,
) {
    if let Some(effects) = effects {
        for effect in effects {
            let action = effect.action.as_deref().filter(|value| !value.is_empty());
            let sound = effect.sound.as_deref().filter(|value| !value.is_empty());
            if action.is_none() && sound.is_none() {
                errors.push("effect must declare action and/or sound".to_string());
            }
            validate_action(action, errors);
            validate_condition(effect.when.as_ref(), "when", ctx, errors);
        }
    }
}

fn validate_thumb_assets(
    thumb: &ThumbAssets,
    pack_dir: &Path,
    label: &str,
    errors: &mut Vec<String>,
) {
    validate_skin_asset_file(
        &thumb.default,
        pack_dir,
        &format!("{label}.default"),
        errors,
    );
    if let Some(hover) = &thumb.hover {
        validate_skin_asset_file(hover, pack_dir, &format!("{label}.hover"), errors);
    }
    if let Some(pressed) = &thumb.pressed {
        validate_skin_asset_file(pressed, pack_dir, &format!("{label}.pressed"), errors);
    }
}

fn validate_bitmap_tiled_slider_presentation(
    kind: &str,
    track: Option<&str>,
    fill: Option<&str>,
    thumb: &ThumbAssets,
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
    validate_thumb_assets(thumb, pack_dir, &format!("{kind} thumb"), errors);
    if let Some(fill_path) = fill {
        validate_skin_asset_file(fill_path, pack_dir, &format!("{kind} fill"), errors);
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
            if explicit
                .content_corner_radius
                .is_some_and(|radius| radius < 0.0)
            {
                errors.push("tiledFrame contentCornerRadius must be non-negative".to_string());
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
            if preset
                .content_corner_radius
                .is_some_and(|radius| radius < 0.0)
            {
                errors.push("tiledFrame contentCornerRadius must be non-negative".to_string());
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

fn validate_presentation(
    presentation: &Presentation,
    pack_dir: &Path,
    ctx: &SkinValidationCtx<'_>,
    errors: &mut Vec<String>,
) {
    match presentation {
        Presentation::Bitmap {
            assets,
            assets_when,
            ..
        } => {
            validate_interactive_assets(assets, pack_dir, "bitmap assets", errors);
            if let Some(when) = assets_when {
                validate_interactive_assets_when(when, pack_dir, "bitmap", ctx, errors);
            }
        }
        Presentation::Gif {
            asset, on_complete, ..
        } => {
            validate_skin_asset_file(asset, pack_dir, "gif asset", errors);
            validate_click_effects(on_complete.as_deref(), ctx, errors);
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
        Presentation::BitmapVerticalSlider {
            track,
            fill,
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
                "bitmapVerticalSlider",
                track.as_deref(),
                fill.as_deref(),
                thumb,
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
            fill,
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
                fill.as_deref(),
                thumb,
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
                validate_interactive_assets_when(when, pack_dir, "buttonGroup", ctx, errors);
            }
            validate_skin_asset_file(position_map, pack_dir, "buttonGroup positionMap", errors);
            if elements.is_empty() {
                errors.push("buttonGroup elements must not be empty".into());
            }
            for element in elements {
                validate_click_effects(Some(&element.on_click), ctx, errors);
                validate_condition(element.active_when.as_ref(), "activeWhen", ctx, errors);
                validate_condition(element.enabled_when.as_ref(), "enabledWhen", ctx, errors);
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
    if let Some(opacity) = style.opacity {
        if !(0.0..=1.0).contains(&opacity) {
            errors.push(format!("{field}.opacity must be between 0 and 1"));
        }
    }
}

fn view_layout_style(layout: &ViewLayout) -> Option<&NodeStyle> {
    match layout {
        ViewLayout::Canvas(f) => f.style.as_ref(),
        ViewLayout::Row(f) | ViewLayout::Column(f) => f.style.as_ref(),
    }
}

fn view_layout_style_when(layout: &ViewLayout) -> Option<&OverlayWhen<NodeStyle>> {
    match layout {
        ViewLayout::Canvas(f) => f.style_when.as_ref(),
        ViewLayout::Row(f) | ViewLayout::Column(f) => f.style_when.as_ref(),
    }
}

fn view_layout_transition_when(layout: &ViewLayout) -> Option<&OverlayWhen<LayoutTransition>> {
    match layout {
        ViewLayout::Canvas(f) => f.transition_when.as_ref(),
        ViewLayout::Row(f) | ViewLayout::Column(f) => f.transition_when.as_ref(),
    }
}

fn layout_node_style(node: &LayoutNode) -> Option<&NodeStyle> {
    match node {
        LayoutNode::Row(f) | LayoutNode::Column(f) | LayoutNode::Overlay(f) => f.style.as_ref(),
        LayoutNode::Subview(f) => f.style.as_ref(),
        LayoutNode::Decoration(f) => f.style.as_ref(),
        LayoutNode::Button(f)
        | LayoutNode::Artwork(f)
        | LayoutNode::Transport(f)
        | LayoutNode::Visualizer(f)
        | LayoutNode::Rating(f)
        | LayoutNode::Time(f) => f.style.as_ref(),
        LayoutNode::Slider(f) => f.base.style.as_ref(),
        LayoutNode::ButtonGroup(f) => f.style.as_ref(),
        LayoutNode::Text(f) => f.style.as_ref(),
        LayoutNode::Input(f) => f.style.as_ref(),
        LayoutNode::Playlist(f) => f.style.as_ref(),
        LayoutNode::TiledFrame(f) => f.style.as_ref(),
        LayoutNode::Slideshow(f) => f.style.as_ref(),
        LayoutNode::ScrollStrip(f) => f.style.as_ref(),
    }
}

fn layout_node_transition(node: &LayoutNode) -> Option<&LayoutTransition> {
    match node {
        LayoutNode::Row(f) | LayoutNode::Column(f) | LayoutNode::Overlay(f) => {
            f.transition.as_ref()
        }
        LayoutNode::Subview(f) => f.transition.as_ref(),
        LayoutNode::Decoration(f) => f.transition.as_ref(),
        LayoutNode::Button(f)
        | LayoutNode::Artwork(f)
        | LayoutNode::Transport(f)
        | LayoutNode::Visualizer(f)
        | LayoutNode::Rating(f)
        | LayoutNode::Time(f) => f.transition.as_ref(),
        LayoutNode::Slider(f) => f.base.transition.as_ref(),
        LayoutNode::ButtonGroup(f) => f.transition.as_ref(),
        LayoutNode::Text(f) => f.transition.as_ref(),
        LayoutNode::Input(f) => f.transition.as_ref(),
        LayoutNode::Playlist(f) => f.transition.as_ref(),
        LayoutNode::TiledFrame(f) => f.transition.as_ref(),
        LayoutNode::Slideshow(f) => f.transition.as_ref(),
        LayoutNode::ScrollStrip(f) => f.transition.as_ref(),
    }
}

fn layout_node_style_when(node: &LayoutNode) -> Option<&OverlayWhen<NodeStyle>> {
    match node {
        LayoutNode::Row(f) | LayoutNode::Column(f) | LayoutNode::Overlay(f) => {
            f.style_when.as_ref()
        }
        LayoutNode::Subview(f) => f.style_when.as_ref(),
        LayoutNode::Decoration(f) => f.style_when.as_ref(),
        LayoutNode::Button(f)
        | LayoutNode::Artwork(f)
        | LayoutNode::Transport(f)
        | LayoutNode::Visualizer(f)
        | LayoutNode::Rating(f)
        | LayoutNode::Time(f) => f.style_when.as_ref(),
        LayoutNode::Slider(f) => f.base.style_when.as_ref(),
        LayoutNode::ButtonGroup(f) => f.style_when.as_ref(),
        LayoutNode::Text(f) => f.style_when.as_ref(),
        LayoutNode::Input(f) => f.style_when.as_ref(),
        LayoutNode::Playlist(f) => f.style_when.as_ref(),
        LayoutNode::TiledFrame(f) => f.style_when.as_ref(),
        LayoutNode::Slideshow(f) => f.style_when.as_ref(),
        LayoutNode::ScrollStrip(f) => f.style_when.as_ref(),
    }
}

fn layout_node_bounds_when(node: &LayoutNode) -> Option<&OverlayWhen<LayoutBoundsOverride>> {
    match node {
        LayoutNode::Row(f) | LayoutNode::Column(f) | LayoutNode::Overlay(f) => {
            f.bounds_when.as_ref()
        }
        LayoutNode::Subview(f) => f.bounds_when.as_ref(),
        LayoutNode::Decoration(f) => f.bounds_when.as_ref(),
        LayoutNode::Button(f)
        | LayoutNode::Artwork(f)
        | LayoutNode::Transport(f)
        | LayoutNode::Visualizer(f)
        | LayoutNode::Rating(f)
        | LayoutNode::Time(f) => f.bounds_when.as_ref(),
        LayoutNode::Slider(f) => f.base.bounds_when.as_ref(),
        LayoutNode::ButtonGroup(f) => f.bounds_when.as_ref(),
        LayoutNode::Text(f) => f.bounds_when.as_ref(),
        LayoutNode::Input(f) => f.bounds_when.as_ref(),
        LayoutNode::Playlist(f) => f.bounds_when.as_ref(),
        LayoutNode::TiledFrame(_) | LayoutNode::Slideshow(_) | LayoutNode::ScrollStrip(_) => None,
    }
}

fn layout_node_transition_when(node: &LayoutNode) -> Option<&OverlayWhen<LayoutTransition>> {
    match node {
        LayoutNode::Row(f) | LayoutNode::Column(f) | LayoutNode::Overlay(f) => {
            f.transition_when.as_ref()
        }
        LayoutNode::Subview(f) => f.transition_when.as_ref(),
        LayoutNode::Decoration(f) => f.transition_when.as_ref(),
        LayoutNode::Button(f)
        | LayoutNode::Artwork(f)
        | LayoutNode::Transport(f)
        | LayoutNode::Visualizer(f)
        | LayoutNode::Rating(f)
        | LayoutNode::Time(f) => f.transition_when.as_ref(),
        LayoutNode::Slider(f) => f.base.transition_when.as_ref(),
        LayoutNode::ButtonGroup(f) => f.transition_when.as_ref(),
        LayoutNode::Text(f) => f.transition_when.as_ref(),
        LayoutNode::Input(f) => f.transition_when.as_ref(),
        LayoutNode::Playlist(f) => f.transition_when.as_ref(),
        LayoutNode::TiledFrame(f) => f.transition_when.as_ref(),
        LayoutNode::Slideshow(f) => f.transition_when.as_ref(),
        LayoutNode::ScrollStrip(f) => f.transition_when.as_ref(),
    }
}

fn view_layout_transition(layout: &ViewLayout) -> Option<&LayoutTransition> {
    match layout {
        ViewLayout::Canvas(f) => f.transition.as_ref(),
        ViewLayout::Row(f) | ViewLayout::Column(f) => f.transition.as_ref(),
    }
}

const LAYOUT_EASINGS: &[&str] = &["linear", "ease", "ease-in", "ease-out", "ease-in-out"];

fn validate_style_when(
    when: Option<&OverlayWhen<NodeStyle>>,
    ctx: &SkinValidationCtx<'_>,
    errors: &mut Vec<String>,
) {
    let Some(when) = when else {
        return;
    };
    when.validate("styleWhen", ctx, errors, |style, field, errors| {
        validate_node_style(Some(style), field, errors);
    });
}

fn validate_transition_when(
    when: Option<&OverlayWhen<LayoutTransition>>,
    ctx: &SkinValidationCtx<'_>,
    errors: &mut Vec<String>,
) {
    let Some(when) = when else {
        return;
    };
    when.validate(
        "transitionWhen",
        ctx,
        errors,
        |transition, field, errors| {
            validate_layout_transition(Some(transition), field, errors);
        },
    );
}

fn validate_bounds_when(
    when: Option<&OverlayWhen<LayoutBoundsOverride>>,
    ctx: &SkinValidationCtx<'_>,
    errors: &mut Vec<String>,
) {
    let Some(when) = when else {
        return;
    };
    when.validate("boundsWhen", ctx, errors, |_, _, _| {});
}

fn validate_layout_transition(
    transition: Option<&LayoutTransition>,
    field: &str,
    errors: &mut Vec<String>,
) {
    let Some(transition) = transition else {
        return;
    };
    if let Some(easing) = &transition.easing {
        if !LAYOUT_EASINGS.contains(&easing.as_str()) {
            errors.push(format!(
                "{field}.easing \"{easing}\" must be linear, ease, ease-in, ease-out, or ease-in-out"
            ));
        }
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

fn layout_where(view_name: &str, node_id: Option<&str>) -> String {
    match node_id.map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => format!("{view_name}/{id}"),
        None => view_name.to_string(),
    }
}

fn prefix_from(errors: &mut Vec<String>, start: usize, prefix: &str) {
    for err in errors.iter_mut().skip(start) {
        *err = format!("{prefix}: {err}");
    }
}

fn view_layout_id(layout: &ViewLayout) -> Option<&str> {
    match layout {
        ViewLayout::Canvas(f) => f.id.as_deref(),
        ViewLayout::Row(f) | ViewLayout::Column(f) => f.id.as_deref(),
    }
}

fn view_layout_children(layout: &ViewLayout) -> &[LayoutNode] {
    match layout {
        ViewLayout::Canvas(f) => &f.children,
        ViewLayout::Row(f) | ViewLayout::Column(f) => &f.children,
    }
}

fn layout_node_id(node: &LayoutNode) -> Option<&str> {
    match node {
        LayoutNode::Row(f) | LayoutNode::Column(f) | LayoutNode::Overlay(f) => f.id.as_deref(),
        LayoutNode::Subview(f) => f.id.as_deref(),
        LayoutNode::Decoration(f) => f.id.as_deref(),
        LayoutNode::Button(f)
        | LayoutNode::Artwork(f)
        | LayoutNode::Transport(f)
        | LayoutNode::Visualizer(f)
        | LayoutNode::Rating(f)
        | LayoutNode::Time(f) => f.id.as_deref(),
        LayoutNode::Slider(f) => f.base.id.as_deref(),
        LayoutNode::ButtonGroup(f) => f.id.as_deref(),
        LayoutNode::Text(f) => f.id.as_deref(),
        LayoutNode::Input(f) => f.id.as_deref(),
        LayoutNode::Playlist(f) => f.id.as_deref(),
        LayoutNode::TiledFrame(f) => f.id.as_deref(),
        LayoutNode::Slideshow(f) => f.id.as_deref(),
        LayoutNode::ScrollStrip(f) => f.id.as_deref(),
    }
}

fn layout_node_children(node: &LayoutNode) -> &[LayoutNode] {
    match node {
        LayoutNode::Row(f) | LayoutNode::Column(f) | LayoutNode::Overlay(f) => &f.children,
        LayoutNode::Subview(f) => &f.children,
        LayoutNode::TiledFrame(f) => &f.children,
        _ => &[],
    }
}

fn validate_control_fields(
    f: &ControlFields,
    pack_dir: &Path,
    ctx: &SkinValidationCtx<'_>,
    errors: &mut Vec<String>,
) {
    validate_click_effects(f.on_click.as_deref(), ctx, errors);
    validate_bind(f.bind.as_deref(), "bind", ctx, errors);
    validate_condition(f.enabled_when.as_ref(), "enabledWhen", ctx, errors);
    validate_condition(f.active_when.as_ref(), "activeWhen", ctx, errors);
    validate_condition(f.visible_when.as_ref(), "visibleWhen", ctx, errors);
    if let Some(bounds) = &f.bounds {
        validate_bounds(bounds, "bounds", errors);
    }
    validate_presentation(&f.presentation, pack_dir, ctx, errors);
}

fn validate_slider_fields(
    f: &SliderFields,
    pack_dir: &Path,
    ctx: &SkinValidationCtx<'_>,
    errors: &mut Vec<String>,
) {
    validate_control_fields(&f.base, pack_dir, ctx, errors);
    if f.base.object_fit.is_some() {
        errors.push("objectFit is only valid on artwork nodes".into());
    }

    let is_primitive = matches!(f.base.presentation, Presentation::Primitive { .. });
    match &f.control {
        Some(SliderControl::Eq) => {
            match f.band {
                Some(band) if (1..=10).contains(&band) => {}
                Some(band) => {
                    errors.push(format!(
                        "slider control eq band must be between 1 and 10, got {band}"
                    ));
                }
                None => {
                    errors.push("slider control eq requires band (1–10)".into());
                }
            }
            if let Some(spread) = &f.spread {
                if spread != "linear" {
                    errors.push(format!(
                        "slider control eq spread must be \"linear\", got {spread}"
                    ));
                }
            }
            if is_primitive {
                errors.push("slider control eq does not support primitive presentation".into());
            }
        }
        Some(SliderControl::Volume) | Some(SliderControl::Seek) => {
            if f.band.is_some() {
                errors.push("slider band is only valid when control is eq".into());
            }
            if f.spread.is_some() {
                errors.push("slider spread is only valid when control is eq".into());
            }
        }
        Some(SliderControl::Balance) | None => {
            if f.band.is_some() {
                errors.push("slider band is only valid when control is eq".into());
            }
            if f.spread.is_some() {
                errors.push("slider spread is only valid when control is eq".into());
            }
            if is_primitive {
                errors.push(
                    "slider primitive presentation is only valid when control is volume or seek"
                        .into(),
                );
            }
        }
    }
}

fn validate_view_layout(
    layout: &ViewLayout,
    pack_dir: &Path,
    view_name: &str,
    ctx: &SkinValidationCtx<'_>,
    errors: &mut Vec<String>,
) {
    let start = errors.len();
    validate_node_style(view_layout_style(layout), "style", errors);
    validate_style_when(view_layout_style_when(layout), ctx, errors);
    validate_layout_transition(view_layout_transition(layout), "transition", errors);
    validate_transition_when(view_layout_transition_when(layout), ctx, errors);
    match layout {
        ViewLayout::Canvas(f) => {
            if f.width == 0 || f.height == 0 {
                errors.push("canvas root width and height must be at least 1".into());
            }
            validate_condition(f.visible_when.as_ref(), "visibleWhen", ctx, errors);
        }
        ViewLayout::Row(f) | ViewLayout::Column(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", ctx, errors);
            validate_bounds_when(f.bounds_when.as_ref(), ctx, errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
        }
    }
    prefix_from(
        errors,
        start,
        &layout_where(view_name, view_layout_id(layout)),
    );
    for child in view_layout_children(layout) {
        validate_layout_node(child, pack_dir, view_name, ctx, errors);
    }
}

fn validate_layout_node(
    node: &LayoutNode,
    pack_dir: &Path,
    view_name: &str,
    ctx: &SkinValidationCtx<'_>,
    errors: &mut Vec<String>,
) {
    let start = errors.len();
    validate_node_style(layout_node_style(node), "style", errors);
    validate_style_when(layout_node_style_when(node), ctx, errors);
    validate_layout_transition(layout_node_transition(node), "transition", errors);
    validate_transition_when(layout_node_transition_when(node), ctx, errors);
    validate_bounds_when(layout_node_bounds_when(node), ctx, errors);
    match node {
        LayoutNode::Row(f) | LayoutNode::Column(f) | LayoutNode::Overlay(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", ctx, errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
        }
        LayoutNode::Subview(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", ctx, errors);
            validate_bounds(&f.bounds, "bounds", errors);
            validate_click_effects(f.on_hover_leave.as_deref(), ctx, errors);
        }
        LayoutNode::Decoration(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", ctx, errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_presentation(&f.presentation, pack_dir, ctx, errors);
        }
        LayoutNode::Artwork(f) => {
            validate_control_fields(f, pack_dir, ctx, errors);
            if let Some(fit) = f.object_fit.as_deref() {
                if !matches!(fit, "cover" | "contain" | "fill") {
                    errors.push(format!(
                        "artwork objectFit \"{fit}\" must be cover, contain, or fill"
                    ));
                }
            }
        }
        LayoutNode::Button(f)
        | LayoutNode::Transport(f)
        | LayoutNode::Visualizer(f)
        | LayoutNode::Rating(f)
        | LayoutNode::Time(f) => {
            validate_control_fields(f, pack_dir, ctx, errors);
            if f.object_fit.is_some() {
                errors.push("objectFit is only valid on artwork nodes".into());
            }
        }
        LayoutNode::Playlist(f) => {
            validate_node_style(f.playing_row_style.as_ref(), "playingRowStyle", errors);
            validate_node_style(f.current_row_style.as_ref(), "currentRowStyle", errors);
            validate_node_style(f.source_style.as_ref(), "sourceStyle", errors);
            validate_node_style(f.source_hover_style.as_ref(), "sourceHoverStyle", errors);
            validate_node_style(f.row_hover_style.as_ref(), "rowHoverStyle", errors);
            validate_condition(f.visible_when.as_ref(), "visibleWhen", ctx, errors);
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
            if let Some(items) = &f.items {
                if items != "tracks" && items != "sources" {
                    errors.push(format!(
                        "playlist items \"{items}\" must be tracks or sources"
                    ));
                }
            }
        }
        LayoutNode::Slider(f) => {
            validate_slider_fields(f, pack_dir, ctx, errors);
        }
        LayoutNode::ButtonGroup(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", ctx, errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_presentation(&f.presentation, pack_dir, ctx, errors);
        }
        LayoutNode::Text(f) => {
            validate_bind(f.bind.as_deref(), "bind", ctx, errors);
            validate_condition(f.visible_when.as_ref(), "visibleWhen", ctx, errors);
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
        LayoutNode::Input(f) => {
            validate_click_effects(f.on_change.as_deref(), ctx, errors);
            validate_condition(f.enabled_when.as_ref(), "enabledWhen", ctx, errors);
            validate_condition(f.visible_when.as_ref(), "visibleWhen", ctx, errors);
            if let Some(max_length) = f.max_length {
                if max_length == 0 {
                    errors.push("input maxLength must be >= 1".into());
                }
            }
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
        }
        LayoutNode::TiledFrame(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", ctx, errors);
            if let Some(bounds) = &f.bounds {
                validate_bounds(bounds, "bounds", errors);
            }
            validate_tiled_frame_presentation(&f.presentation, pack_dir, errors);
        }
        LayoutNode::Slideshow(f) => {
            validate_condition(f.visible_when.as_ref(), "visibleWhen", ctx, errors);
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
            validate_condition(f.visible_when.as_ref(), "visibleWhen", ctx, errors);
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
    prefix_from(
        errors,
        start,
        &layout_where(view_name, layout_node_id(node)),
    );
    for child in layout_node_children(node) {
        validate_layout_node(child, pack_dir, view_name, ctx, errors);
    }
}

fn is_valid_skin_setting_id(id: &str) -> bool {
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => chars.all(|c| c.is_ascii_alphanumeric()),
        _ => false,
    }
}

fn validate_settings(
    settings: Option<&[SkinSetting]>,
    errors: &mut Vec<String>,
) -> HashSet<String> {
    let mut declared = HashSet::new();
    let Some(settings) = settings else {
        return declared;
    };
    for (index, setting) in settings.iter().enumerate() {
        let label = format!("settings[{index}]");
        let id = setting.id.trim();
        if id.is_empty() {
            errors.push(format!("{label}.id cannot be empty"));
            continue;
        }
        if !is_valid_skin_setting_id(id) {
            errors.push(format!(
                "{label}.id \"{id}\" must be camelCase starting with a lowercase letter"
            ));
            continue;
        }
        if BUILTIN_SKIN_PREF_IDS.contains(&id) {
            errors.push(format!(
                "{label}.id \"{id}\" collides with a built-in skin preference"
            ));
            continue;
        }
        if !declared.insert(id.to_string()) {
            errors.push(format!("{label}.id \"{id}\" is duplicated"));
            continue;
        }
        if setting.name.trim().is_empty() {
            errors.push(format!("{label}.name cannot be empty"));
        }
        if setting.name.len() > 80 {
            errors.push(format!("{label}.name must be at most 80 characters"));
        }
        if let Some(description) = &setting.description {
            if description.len() > 280 {
                errors.push(format!(
                    "{label}.description must be at most 280 characters"
                ));
            }
        }
        match setting.setting_type.as_str() {
            "boolean" => {
                if !setting.default.is_boolean() {
                    errors.push(format!(
                        "{label}.default must be a boolean when type is boolean"
                    ));
                }
            }
            other => {
                errors.push(format!(
                    "{label}.type \"{other}\" is not supported (v1 allows boolean only)"
                ));
            }
        }
    }
    declared
}

pub fn validate_skin_manifest(manifest: &SkinManifest, pack_dir: &Path) -> Result<(), String> {
    let mut errors: Vec<String> = Vec::new();

    let declared_pref_ids = validate_settings(manifest.settings.as_deref(), &mut errors);
    let ctx = SkinValidationCtx {
        declared_pref_ids: &declared_pref_ids,
    };

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
        validate_click_effects(view.on_activate.as_deref(), &ctx, &mut errors);
        if let Some(state) = &view.state {
            for name in state.keys() {
                if RESERVED_STATE_VARIABLE_IDS.contains(&name.as_str()) {
                    errors.push(format!(
                        "views.{view_name}.state.{name} collides with a state action id"
                    ));
                }
            }
            for spec in state.values() {
                if let Some(on) = &spec.on {
                    for branches in on.values() {
                        for branch in branches {
                            validate_layout_transition(
                                branch.transition.as_ref(),
                                "transition",
                                &mut errors,
                            );
                        }
                    }
                }
            }
        }
        validate_view_layout(&view.layout, pack_dir, view_name, &ctx, &mut errors);
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
    fn accepts_playlist_items_sources() {
        let (dir, path) = write_skin_json(
            "playlist-items-sources",
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
                        "items":"sources",
                        "showDropdown":false
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
    fn rejects_unknown_playlist_items() {
        let (dir, path) = write_skin_json(
            "playlist-bad-items",
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
                        "items":"albums"
                      }
                    ]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(
            err.contains("items") || err.contains("valid skin JSON"),
            "unexpected error: {err}"
        );
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
    fn accepts_input_node_with_placeholder_and_on_change() {
        let (dir, path) = write_skin_json(
            "input-playlist-filter",
            r##"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                    "type":"input",
                    "id":"plSearchEdit",
                    "placeholder":"Search...",
                    "style":{"color":"#C1D0E7","fontSize":8,"backgroundColor":"#000000"},
                    "onChange":[{"action":"playlist.setFilter"}]
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
    fn rejects_input_node_with_presentation() {
        let (dir, path) = write_skin_json(
            "input-with-presentation",
            r#"{
              "name":"Vanilla",
              "author":"Spiral",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"column",
                    "children":[{
                    "type":"input",
                    "placeholder":"Search...",
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
    fn accepts_playlist_source_and_row_hover_styles() {
        let (dir, path) = write_skin_json(
            "playlist-source-hover-styles",
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
                      "sourceStyle":{"backgroundColor":"#0a1200"},
                      "sourceHoverStyle":{"backgroundColor":"#142000"},
                      "rowHoverStyle":{"backgroundColor":"rgba(204,255,0,0.12)"}
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
    fn accepts_hover_bind_and_style_when() {
        let (dir, path) = write_skin_json(
            "hover-style-when",
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
                      "type":"subview",
                      "id":"visFrame",
                      "bounds":{"x":0,"y":0,"w":100,"h":80},
                      "children":[{
                        "type":"subview",
                        "id":"visMeta",
                        "bounds":{"x":0,"y":0,"w":100,"h":20},
                        "style":{"opacity":0},
                        "styleWhen":{"hover.visFrame":{"opacity":1}},
                        "transition":{"durationMs":200,"easing":"ease-out"},
                        "children":[]
                      }]
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
    fn accepts_style_when_list_with_compound_condition() {
        let (dir, path) = write_skin_json(
            "style-when-list",
            r##"{
              "name":"Lost Planet",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "state":{
                    "galleryPhase":{"default":"grid"}
                  },
                  "layout":{
                    "type":"canvas",
                    "width":100,
                    "height":80,
                    "children":[{
                      "type":"button",
                      "id":"thumb1",
                      "bounds":{"x":0,"y":0,"w":10,"h":10},
                      "style":{"opacity":0},
                      "styleWhen":[
                        {"when":"state.galleryPhase.grid","opacity":0.71},
                        {"when":{"all":["state.galleryPhase.grid","hover.thumb1"]},"opacity":1}
                      ],
                      "presentation":{"kind":"primitive","variant":"plain"}
                    }]
                  }
                }
              }
            }"##,
        );
        validate_skin_contribution_at(&path).unwrap();
        let manifest = read_skin_manifest(&path).unwrap();
        let ViewLayout::Canvas(canvas) = &manifest.views["main"].layout else {
            panic!("expected canvas");
        };
        let LayoutNode::Button(node) = &canvas.children[0] else {
            panic!("expected button");
        };
        let OverlayWhen::List(rows) = node.style_when.as_ref().unwrap() else {
            panic!("expected styleWhen list");
        };
        assert_eq!(rows.len(), 2);
        assert!(matches!(
            rows[1].when,
            SkinCondition::All { ref all } if all.len() == 2
        ));
        assert_eq!(rows[1].overlay.opacity, Some(1.0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_artwork_object_fit() {
        let (dir, path) = write_skin_json(
            "artwork-object-fit",
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
                      "type":"artwork",
                      "id":"art",
                      "objectFit":"contain",
                      "style":{"backgroundColor":"#000000"},
                      "presentation":{"kind":"css","className":"skin-artwork"}
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
    fn accepts_rating_primitive() {
        let (dir, path) = write_skin_json(
            "rating-primitive",
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
                      "type":"rating",
                      "id":"visRatingStars",
                      "style":{"color":"#F5A623"},
                      "enabledWhen":"player.hasTrack",
                      "presentation":{"kind":"primitive"}
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
    fn rejects_object_fit_on_non_artwork() {
        let (dir, path) = write_skin_json(
            "object-fit-on-button",
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
                      "type":"button",
                      "objectFit":"contain",
                      "presentation":{"kind":"primitive"},
                      "onClick":[{"action":"player.playPause"}]
                    }]
                  }
                }
              }
            }"##,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("objectFit"), "unexpected error: {err}");
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
                      "onClick":[{"action":"state.applyEvent"}],
                      "soundWhen":{
                        "state.shutter.intro":"open",
                        "state.shutter.open":"close"
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
            sound_when.get("state.shutter.intro").map(String::as_str),
            Some("open")
        );
        assert_eq!(
            sound_when.get("state.shutter.open").map(String::as_str),
            Some("close")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preserves_subview_on_hover_leave() {
        let (dir, path) = write_skin_json(
            "hover-leave",
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
                      "type":"subview",
                      "id":"cMenuHotspot",
                      "bounds":{"x":0,"y":0,"w":10,"h":10},
                      "children":[],
                      "onHoverLeave":[{
                        "action":"state.applyEvent",
                        "payload":{"variable":"menuMode","event":"collapse"}
                      }]
                    }]
                  }
                }
              }
            }"#,
        );
        validate_skin_contribution_at(&path).unwrap();
        let manifest = read_skin_manifest(&path).unwrap();
        let ViewLayout::Canvas(canvas) = &manifest.views["main"].layout else {
            panic!("expected canvas");
        };
        let LayoutNode::Subview(subview) = &canvas.children[0] else {
            panic!("expected subview");
        };
        let effects = subview
            .on_hover_leave
            .as_ref()
            .expect("onHoverLeave dropped");
        assert_eq!(effects[0].action.as_deref(), Some("state.applyEvent"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_button_group_element_without_onclick() {
        let (dir, path) = write_skin_json(
            "bg-no-click",
            r##"{
              "name":"Vanilla",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"canvas",
                    "width":10,
                    "height":10,
                    "children":[{
                      "type":"buttonGroup",
                      "presentation":{
                        "kind":"buttonGroup",
                        "assets":{"default":"g.png"},
                        "positionMap":"g-map.png",
                        "width":10,
                        "height":10,
                        "elements":[{"mappingColor":"#3366ff","tooltip":"Open audio controls"}]
                      }
                    }]
                  }
                }
              }
            }"##,
        );
        let manifest = read_skin_manifest(&path).unwrap();
        let ViewLayout::Canvas(canvas) = &manifest.views["main"].layout else {
            panic!("expected canvas");
        };
        let LayoutNode::ButtonGroup(group) = &canvas.children[0] else {
            panic!("expected buttonGroup");
        };
        let Presentation::ButtonGroup { elements, .. } = &group.presentation else {
            panic!("expected buttonGroup presentation");
        };
        assert!(elements[0].on_click.is_empty());
        assert_eq!(elements[0].tooltip.as_deref(), Some("Open audio controls"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_horizontal_eq_band() {
        let (dir, path) = write_skin_json(
            "eq-horizontal",
            r#"{
              "name":"Vanilla",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"canvas",
                    "width":100,
                    "height":80,
                    "children":[{
                      "type":"slider",
                      "control":"eq",
                      "band":1,
                      "presentation":{
                        "kind":"bitmapHorizontalSlider",
                        "thumb":{"default":"sliders/t.png"},
                        "trackWidth":120,
                        "trackHeight":20,
                        "thumbWidth":12,
                        "thumbHeight":20,
                        "borderSize":10
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
        let LayoutNode::Slider(slider) = &canvas.children[0] else {
            panic!("expected slider");
        };
        assert_eq!(slider.control, Some(SliderControl::Eq));
        assert_eq!(slider.band, Some(1));
        assert!(slider.spread.is_none());
        assert!(matches!(
            slider.base.presentation,
            Presentation::BitmapHorizontalSlider { .. }
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_eq_band_linear_spread() {
        let (dir, path) = write_skin_json(
            "eq-spread",
            r#"{
              "name":"Vanilla",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"canvas",
                    "width":100,
                    "height":80,
                    "children":[{
                      "type":"slider",
                      "control":"eq",
                      "band":1,
                      "spread":"linear",
                      "presentation":{
                        "kind":"bitmapHorizontalSlider",
                        "thumb":{"default":"sliders/t.png"},
                        "trackWidth":120,
                        "trackHeight":20,
                        "thumbWidth":12,
                        "thumbHeight":20,
                        "borderSize":10
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
        let LayoutNode::Slider(slider) = &canvas.children[0] else {
            panic!("expected slider");
        };
        assert_eq!(slider.spread.as_deref(), Some("linear"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_nested_slider_thumb_assets() {
        let (dir, path) = write_skin_json(
            "nested-thumb",
            r#"{
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
                      "type":"slider",
                      "control":"volume",
                      "presentation":{
                        "kind":"bitmapVerticalSlider",
                        "thumb":{
                          "default":"sliders/t.png",
                          "hover":"sliders/t-h.png",
                          "pressed":"sliders/t-p.png"
                        },
                        "trackWidth":24,
                        "trackHeight":82,
                        "thumbWidth":24,
                        "thumbHeight":21
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
        let LayoutNode::Slider(slider) = &canvas.children[0] else {
            panic!("expected slider");
        };
        assert_eq!(slider.control, Some(SliderControl::Volume));
        let Presentation::BitmapVerticalSlider { thumb, .. } = &slider.base.presentation else {
            panic!("expected bitmapVerticalSlider");
        };
        assert_eq!(thumb.default, "sliders/t.png");
        assert_eq!(thumb.hover.as_deref(), Some("sliders/t-h.png"));
        assert_eq!(thumb.pressed.as_deref(), Some("sliders/t-p.png"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_slider_with_literal_false_enabled_when() {
        let (dir, path) = write_skin_json(
            "generic-slider",
            r#"{
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
                      "id":"truBass",
                      "type":"slider",
                      "enabledWhen":false,
                      "presentation":{
                        "kind":"bitmapHorizontalSlider",
                        "thumb":{"default":"sliders/t.png"},
                        "trackWidth":86,
                        "trackHeight":7,
                        "thumbWidth":7,
                        "thumbHeight":7,
                        "borderSize":4
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
        let LayoutNode::Slider(slider) = &canvas.children[0] else {
            panic!("expected slider");
        };
        assert!(slider.control.is_none());
        assert!(matches!(
            slider.base.enabled_when,
            Some(SkinCondition::Bool(false))
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_flat_slider_thumb_path() {
        let (dir, path) = write_skin_json(
            "flat-thumb",
            r#"{
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
                      "type":"slider",
                      "control":"volume",
                      "presentation":{
                        "kind":"bitmapVerticalSlider",
                        "thumb":"sliders/t.png",
                        "trackWidth":24,
                        "trackHeight":82,
                        "thumbWidth":24,
                        "thumbHeight":21
                      }
                    }]
                  }
                }
              }
            }"#,
        );
        let err = read_skin_manifest(&path).unwrap_err();
        assert!(!err.is_empty(), "expected nested thumb object, got success");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_sound_on_click_effect() {
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
                      "onClick":[
                        {"action":"skin.openPicker"},
                        {"delayMs":500,"sound":"button"}
                      ],
                      "presentation":{"kind":"primitive"}
                    }]
                  }
                }
              }
            }"#,
        );
        validate_skin_contribution_at(&path).unwrap();
        let manifest = read_skin_manifest(&path).unwrap();
        let ViewLayout::Column(column) = &manifest.views["main"].layout else {
            panic!("expected column");
        };
        let LayoutNode::Button(button) = &column.children[0] else {
            panic!("expected button");
        };
        let effects = button.on_click.as_ref().expect("onClick dropped");
        assert_eq!(effects[0].action.as_deref(), Some("skin.openPicker"));
        assert_eq!(effects[1].delay_ms, Some(500));
        assert_eq!(effects[1].sound.as_deref(), Some("button"));
        assert!(effects[1].action.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_effect_without_action_or_sound() {
        let (dir, path) = write_skin_json(
            "empty-effect",
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
                      "onClick":[{"delayMs":500}],
                      "presentation":{"kind":"primitive"}
                    }]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(
            err.contains("action") || err.contains("sound") || err.contains("valid skin JSON"),
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
    fn preserves_layout_transition() {
        let (dir, path) = write_skin_json(
            "layout-transition",
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
                    "children":[{
                      "type":"decoration",
                      "bounds":{"x":0,"y":0,"w":10,"h":10},
                      "boundsWhen":{"state.eq.open":{"x":0}},
                      "transition":{"durationMs":120,"easing":"linear"},
                      "presentation":{"kind":"bitmap","assets":{"default":"x.png"}}
                    }]
                  },
                  "state":{
                    "eq":{
                      "default":"closed",
                      "on":{
                        "toggle":[{
                          "from":["closed"],
                          "set":"open",
                          "transition":{"durationMs":120}
                        }]
                      }
                    }
                  }
                }
              }
            }"#,
        );
        let manifest = read_skin_manifest(&path).unwrap();
        let ViewLayout::Canvas(canvas) = &manifest.views["main"].layout else {
            panic!("expected canvas");
        };
        let LayoutNode::Decoration(deco) = &canvas.children[0] else {
            panic!("expected decoration");
        };
        let t = deco.transition.as_ref().unwrap();
        assert_eq!(t.duration_ms, 120);
        assert_eq!(t.easing.as_deref(), Some("linear"));
        let branch = &manifest.views["main"].state.as_ref().unwrap()["eq"]
            .on
            .as_ref()
            .unwrap()["toggle"][0];
        assert_eq!(branch.transition.as_ref().unwrap().duration_ms, 120);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preserves_transition_when() {
        let (dir, path) = write_skin_json(
            "transition-when",
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
                    "children":[{
                      "type":"subview",
                      "bounds":{"x":0,"y":0,"w":10,"h":10},
                      "transition":{"durationMs":400,"easing":"linear"},
                      "transitionWhen":{"state.intro.showing":{"durationMs":0}},
                      "children":[]
                    }]
                  }
                }
              }
            }"#,
        );
        let manifest = read_skin_manifest(&path).unwrap();
        validate_skin_contribution_at(&path).unwrap();
        let ViewLayout::Canvas(canvas) = &manifest.views["main"].layout else {
            panic!("expected canvas");
        };
        let LayoutNode::Subview(node) = &canvas.children[0] else {
            panic!("expected subview");
        };
        let OverlayWhen::Map(when) = node.transition_when.as_ref().unwrap() else {
            panic!("expected transitionWhen map");
        };
        assert_eq!(when["state.intro.showing"].duration_ms, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unknown_transition_when_bind() {
        let (dir, path) = write_skin_json(
            "bad-transition-when",
            r#"{
              "name":"Vanilla",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"row",
                    "children":[],
                    "transitionWhen":{"nope.foo":{"durationMs":0}}
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(
            err.contains("transitionWhen") && err.contains("nope.foo"),
            "unexpected error: {err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_state_variable_named_like_an_action() {
        let (dir, path) = write_skin_json(
            "reserved-state-id",
            r#"{
              "name":"Vanilla",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "state":{
                    "setVariable":{"default":"idle"}
                  },
                  "layout":{"type":"row","children":[]}
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(
            err.contains("setVariable") && err.contains("state action"),
            "unexpected error: {err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_state_action_id_used_as_a_bind() {
        let (dir, path) = write_skin_json(
            "state-action-as-bind",
            r#"{
              "name":"Vanilla",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"row",
                    "children":[{
                      "type":"text",
                      "value":"x",
                      "visibleWhen":"state.setVariable"
                    }]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("state.setVariable"), "unexpected error: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unknown_transition_easing() {
        let (dir, path) = write_skin_json(
            "bad-easing",
            r#"{
              "name":"Vanilla",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"row",
                    "children":[],
                    "transition":{"durationMs":120,"easing":"spring"}
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("easing"), "unexpected error: {err}");
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

    #[test]
    fn layout_errors_include_view_and_node_id() {
        let (dir, path) = write_skin_json(
            "named-bounds",
            r#"{
              "name":"Lost Planet",
              "author":"a",
              "description":"",
              "views":{
                "plview":{
                  "layout":{
                    "type":"canvas",
                    "width":376,
                    "height":216,
                    "children":[{
                      "type":"subview",
                      "id":"botRight",
                      "bounds":{"right":0,"bottom":0},
                      "children":[]
                    }]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(
            err.contains("plview/botRight: bounds: set w, or both x and right"),
            "unexpected error: {err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn asset_errors_include_view_and_node_id() {
        let (dir, path) = write_skin_json(
            "named-asset",
            r#"{
              "name":"Lost Planet",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"canvas",
                    "width":100,
                    "height":80,
                    "children":[{
                      "type":"decoration",
                      "id":"deco",
                      "bounds":{"x":0,"y":0,"w":10,"h":10},
                      "presentation":{"kind":"bitmap","assets":{"default":"missing.png"}}
                    }]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(
            err.contains("main/deco: bitmap assets.default asset not found"),
            "unexpected error: {err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_boolean_skin_setting() {
        let (dir, path) = write_skin_json(
            "setting-boolean",
            r#"{
              "name":"Vanilla",
              "author":"a",
              "description":"",
              "settings":[{
                "id":"hideHelpBubble",
                "name":"Hide help bubble",
                "description":"Skip the startup tip.",
                "type":"boolean",
                "default":false
              }],
              "views":{
                "main":{
                  "layout":{"type":"canvas","width":100,"height":80,"children":[]}
                }
              }
            }"#,
        );
        validate_skin_contribution_at(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_duplicate_skin_setting_ids() {
        let (dir, path) = write_skin_json(
            "setting-dup",
            r#"{
              "name":"Vanilla",
              "author":"a",
              "description":"",
              "settings":[
                {"id":"foo","name":"Foo","type":"boolean","default":false},
                {"id":"foo","name":"Foo again","type":"boolean","default":true}
              ],
              "views":{
                "main":{
                  "layout":{"type":"canvas","width":100,"height":80,"children":[]}
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("duplicated"), "unexpected error: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_builtin_skin_setting_id_collision() {
        let (dir, path) = write_skin_json(
            "setting-builtin",
            r#"{
              "name":"Vanilla",
              "author":"a",
              "description":"",
              "settings":[{
                "id":"soundEffectsEnabled",
                "name":"Sound FX",
                "type":"boolean",
                "default":true
              }],
              "views":{
                "main":{
                  "layout":{"type":"canvas","width":100,"height":80,"children":[]}
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(err.contains("built-in"), "unexpected error: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unknown_skin_pref_bind() {
        let (dir, path) = write_skin_json(
            "setting-bind",
            r#"{
              "name":"Vanilla",
              "author":"a",
              "description":"",
              "views":{
                "main":{
                  "layout":{
                    "type":"canvas",
                    "width":100,
                    "height":80,
                    "children":[{
                      "type":"subview",
                      "id":"panel",
                      "visibleWhen":"skin.pref.notDeclared",
                      "bounds":{"x":0,"y":0,"w":10,"h":10},
                      "children":[]
                    }]
                  }
                }
              }
            }"#,
        );
        let err = validate_skin_contribution_at(&path).unwrap_err();
        assert!(
            err.contains("unknown skin preference"),
            "unexpected error: {err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
