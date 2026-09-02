//! Spiral pack format: `pack.json` contracts, contribution validators, and `.spk` archives.

mod archive;
mod manifest;
mod skin;
mod theme;
mod visualizer;

pub use archive::{
    cleanup_pack_extract_dir, extract_pack_archive, find_pack_root, write_pack_archive,
};
pub use manifest::*;
pub use skin::{
    read_skin_manifest, validate_skin_contribution_at, validate_skin_manifest, SkinManifest,
};
// Re-export skin schema types used by spiral-desktop's runtime loader.
pub use skin::{
    ButtonGroupElement, ButtonGroupFields, CanvasFields, ContainerFields, ControlFields,
    DecorationFields, DigitStripSlot, FramedPanelInset, InputControlFields, InteractiveAssets,
    LayoutBounds, LayoutBoundsOverride, LayoutNode, LayoutTransition, NodeStyle, PlaylistFields,
    Presentation, ScrollStripFields, ScrollStripItem, ScrollStripPresentation, ScrollStripSlide,
    ScrollStripSlideItem, SkinClickEffect, SkinCondition, SkinLifecycleEffect, SkinView,
    SkinViewStateSpec, SkinViewStateTransition, SkinVisualizer, SliderControl, SliderFields,
    SlideshowDeck, SlideshowFields, SlideshowPresentation, SubviewFields, TextControlFields,
    ThumbAssets, TiledFrameAssets, TiledFrameContentInset, TiledFrameExplicitPresentation,
    TiledFrameFields, TiledFramePresentation, TiledFramePresetPresentation, TiledFrameTileDef,
    TiledFrameTileSize, TiledFrameTileSizes, ViewLayout, WindowChrome,
};
pub use theme::{validate_theme_contribution_at, REQUIRED_THEME_TOKEN_KEYS};
pub use visualizer::{
    is_renderer_effective_id, is_safe_media_asset_path, is_safe_pack_relative_js,
    normalize_viz_manifest, validate_renderer_contribution_at, validate_visualizer_contribution_at,
    RendererManifestFile, VizManifest, VizSurfaceProfile,
};

/// JSON Schema documents for pack and contribution manifests (source of truth).
pub mod schemas {
    pub const PACK_V1: &str = include_str!("../schemas/pack-v1.schema.json");
    pub const THEME_V1: &str = include_str!("../schemas/theme-v1.schema.json");
    pub const SKIN_V1: &str = include_str!("../schemas/skin-v1.schema.json");
    pub const VIZ_V1: &str = include_str!("../schemas/viz-v1.schema.json");
    pub const RENDERER_V1: &str = include_str!("../schemas/renderer-v1.schema.json");
    pub const PRESENTATION_COMMON: &str =
        include_str!("../schemas/presentation-common.schema.json");
}
