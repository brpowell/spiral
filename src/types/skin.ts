/** Mirrors Rust `SkinManifest` / layout types (skin.json v1). */

export type ShellSlot =
  | "header"
  | "art"
  | "info"
  | "controls"
  | "visualizer"
  | "footer";

export interface SkinSummary {
  id: string;
  name: string;
  author: string;
  description: string;
  isBuiltin: boolean;
  previewPath: string | null;
}

export interface LoadedSkinPack {
  summary: SkinSummary;
  packDir: string;
  manifest: SkinManifest;
}

export interface SkinManifest {
  version: number;
  name: string;
  author: string;
  description: string;
  defaultView: string;
  views: Record<string, SkinView>;
  textStyles?: Record<string, TextStyle>;
  window?: WindowChrome;
  visualizer?: SkinVisualizer;
  animations?: unknown;
  timelines?: unknown;
  /** CSS file path relative to the skin pack root. */
  stylesheet?: string;
}

export type LayoutMode = "slots" | "canvas";

export interface SkinCanvasSpec {
  width: number;
  height: number;
  /** Bind path → width when condition is true (e.g. `skin.panel.playlist.open`). */
  widthWhen?: Record<string, number>;
  heightWhen?: Record<string, number>;
}

export interface SkinPanelWindowOverride {
  width?: number;
  height?: number;
}

export interface SkinPanel {
  defaultOpen?: boolean;
  /** Window size overrides while this panel is open (merged with max across open panels). */
  windowWhenOpen?: SkinPanelWindowOverride;
  /** Slide animation duration in ms. */
  motion?: { durationMs?: number };
}

export interface SkinView {
  /** `slots` (default) uses SkinShell regions; `canvas` uses absolute bounds. */
  layoutMode?: LayoutMode;
  /** Logical size of the canvas stage when `layoutMode` is `canvas`. */
  canvas?: SkinCanvasSpec;
  /** In-view overlays toggled via `skin.togglePanel` (drawers, dropdowns). */
  panels?: Record<string, SkinPanel>;
  layout: LayoutNode;
}

export interface LayoutBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex?: number;
}

export type LayoutNode =
  | StackNode
  | RowNode
  | ColumnNode
  | OverlayNode
  | CanvasNode
  | RegionNode
  | DecorationNode
  | ButtonNode
  | ButtonGroupNode
  | SeekbarNode
  | TextNode
  | ArtworkNode
  | TransportNode
  | VisualizerNode
  | VolumeNode
  | BalanceNode
  | EqBandNode
  | QueueNode
  | TimeNode
  | PlaylistNode
  | DragRegionNode;

interface NodeBase {
  id?: string;
  visibleWhen?: string;
  /** Absolute placement on a canvas view (logical px). */
  bounds?: LayoutBounds;
  /** Override `bounds` when a bind path is true (typically `skin.panel.*`). */
  boundsWhen?: Record<string, Partial<LayoutBounds>>;
}

export interface StackNode extends NodeBase {
  type: "stack";
  children: LayoutNode[];
  position?: "relative" | "absolute";
  zIndex?: number;
  /** When true, pointer events on this container move the skin window. */
  dragRegion?: boolean;
}

export interface RowNode extends NodeBase {
  type: "row";
  children: LayoutNode[];
  position?: "relative" | "absolute";
  zIndex?: number;
  dragRegion?: boolean;
}

export interface ColumnNode extends NodeBase {
  type: "column";
  children: LayoutNode[];
  position?: "relative" | "absolute";
  zIndex?: number;
  dragRegion?: boolean;
}

export interface OverlayNode extends NodeBase {
  type: "overlay";
  children: LayoutNode[];
  position?: "relative" | "absolute";
  zIndex?: number;
  dragRegion?: boolean;
}

export interface CanvasNode extends NodeBase {
  type: "canvas";
  children: LayoutNode[];
}

export interface RegionNode extends NodeBase {
  type: "region";
  slot: ShellSlot;
  children: LayoutNode[];
  /** When true, the region is a window drag handle (Tauri drag region). */
  dragRegion?: boolean;
}

export interface DecorationNode extends NodeBase {
  type: "decoration";
  presentation: Presentation;
  /** When true on a canvas view, this decoration is a window drag handle. */
  dragRegion?: boolean;
}

/** Invisible canvas hit target for moving a frameless skin window. */
export interface DragRegionNode extends NodeBase {
  type: "dragRegion";
}

export interface ControlNodeBase extends NodeBase {
  action?: string;
  /** Target panel for `skin.*Panel` actions. */
  panelId?: string;
  bind?: string;
  disabledWhen?: string;
  presentation: Presentation;
}

export interface ButtonNode extends ControlNodeBase {
  type: "button";
}

/** WMP-style composite button with color-keyed hit regions (position map). */
export interface ButtonGroupNode extends NodeBase {
  type: "buttonGroup";
  presentation: ButtonGroupPresentation;
}

export interface ButtonGroupElement {
  /** Hex color matching a region in the position map, e.g. "#0000ff". */
  mappingColor: string;
  action: string;
  /** Target panel for `skin.*Panel` actions. */
  panelId?: string;
}

export interface ButtonGroupPresentation {
  kind: "buttonGroup";
  assetBase: string;
  /** Path under assets/ without extension, e.g. buttons/window-chrome-map */
  positionMap: string;
  width?: number;
  height?: number;
  /** When true, hover uses `{assetBase}-hover.gif` (default/pressed stay PNG). */
  animatedHover?: boolean;
  elements: ButtonGroupElement[];
}

export interface SeekbarNode extends ControlNodeBase {
  type: "seekbar";
}

export interface ArtworkNode extends ControlNodeBase {
  type: "artwork";
}

export interface TransportNode extends ControlNodeBase {
  type: "transport";
}

export interface VisualizerNode extends ControlNodeBase {
  type: "visualizer";
}

export interface VolumeNode extends ControlNodeBase {
  type: "volume";
}

export interface BalanceNode extends ControlNodeBase {
  type: "balance";
}

export interface EqBandNode extends ControlNodeBase {
  type: "eqBand";
  /** 1-based band index (1 = 31 Hz … 10 = 16 kHz). */
  band: number;
}

export interface QueueNode extends ControlNodeBase {
  type: "queue";
}

export interface TimeNode extends ControlNodeBase {
  type: "time";
}

export interface PlaylistNode extends ControlNodeBase {
  type: "playlist";
}

export interface TextNode extends NodeBase {
  type: "text";
  bind?: string;
  /** Static label when `bind` is omitted. */
  value?: string;
  textStyle?: string;
  presentation: Presentation;
}

export type Presentation =
  | BitmapPresentation
  | GifPresentation
  | PrimitivePresentation
  | CssPresentation
  | StripSliderPresentation
  | BitmapVerticalSliderPresentation
  | BitmapHorizontalSliderPresentation
  | BitmapSeekbarPresentation
  | DigitStripPresentation
  | FramedPanelPresentation
  | CompactPlaylistPresentation;

export interface BitmapPresentation {
  kind: "bitmap";
  assetBase: string;
  width?: number;
  height?: number;
  /** When true, hover uses `{assetBase}-hover.gif` (default/pressed stay PNG). */
  animatedHover?: boolean;
}

/** Animated GIF under assets/ (path without extension). Pixels must already have alpha baked in. */
export interface GifPresentation {
  kind: "gif";
  assetBase: string;
}

export interface PrimitivePresentation {
  kind: "primitive";
  classPrefix?: string;
  variant?: string;
}

export interface CssPresentation {
  kind: "css";
  className: string;
  stylesheet?: string;
}

/** WMP-style tiled vertical track + movable thumb (graphic EQ bands). */
export interface BitmapVerticalSliderPresentation {
  kind: "bitmapVerticalSlider";
  /** Track tile path under assets/ without extension (small WMP slice or full-height PNG). */
  track: string;
  /** Thumb image path under assets/ without extension. */
  thumb: string;
  /** Source tile width in px (WMP backgroundImage width). */
  trackTileWidth: number;
  /** Source tile height in px; when less than trackHeight, runtime 3-slice tiling applies. */
  trackTileHeight: number;
  trackWidth: number;
  trackHeight: number;
  thumbWidth: number;
  thumbHeight: number;
  /** Cap size and thumb travel inset (WMP borderSize); enables 3-slice tiling when > 0. */
  borderSize?: number;
  classPrefix?: string;
}

/** WMP-style tiled horizontal track + movable thumb (balance, volume). */
export interface BitmapHorizontalSliderPresentation {
  kind: "bitmapHorizontalSlider";
  track: string;
  thumb: string;
  trackTileWidth: number;
  trackTileHeight: number;
  trackWidth: number;
  trackHeight: number;
  thumbWidth: number;
  thumbHeight: number;
  borderSize?: number;
  classPrefix?: string;
}

/** WMP-style track + fill + thumb seek bar. */
export interface BitmapSeekbarPresentation {
  kind: "bitmapSeekbar";
  /** Path under assets/ without extension, e.g. sliders/seek-track */
  track: string;
  /** Foreground fill image path under assets/ without extension. */
  fill: string;
  /** Thumb image base path; hover/pressed use -hover/-pressed suffixes. */
  thumb: string;
  /** Inset from each track edge for thumb travel (WMP borderSize). */
  borderSize: number;
  trackWidth: number;
  trackHeight: number;
  thumbWidth: number;
  thumbHeight: number;
  classPrefix?: string;
}

/** WMP-style filmstrip slider: one frame per discrete value step. */
export interface StripSliderPresentation {
  kind: "stripSlider";
  /** Path under assets/ without extension, e.g. sliders/seek */
  strip: string;
  /** Optional position map for non-linear hit testing (WMP positionImage). */
  positionMap?: string;
  frameWidth: number;
  frameHeight?: number;
  frameCount: number;
  direction?: "horizontal" | "vertical";
  /** When true, reverses pointer→value mapping only (display follows value normally). */
  invert?: boolean;
  classPrefix?: string;
}

/** WMP-style horizontal digit strip for MM:SS (and sign) display. */
export interface DigitStripPresentation {
  kind: "digitStrip";
  /** Path under assets/ without extension, e.g. time/numbers */
  strip: string;
  frameWidth: number;
  frameHeight: number;
  /** Digit/sign windows within the control bounds (logical px). */
  slots: DigitStripSlot[];
  /** Strip frame index for elapsed-mode separator (default 10). */
  signFrameElapsed?: number;
  /** Strip frame index for remaining-mode prefix (default 11). */
  signFrameRemaining?: number;
  classPrefix?: string;
}

export interface DigitStripSlot {
  role: "sign" | "minuteTens" | "minuteOnes" | "secondTens" | "secondOnes";
  x: number;
}

/** WMP-style viz panel: bitmap mask clip + optional frame overlay (vid_bkgd pattern). */
export interface FramedPanelPresentation {
  kind: "framedPanel";
  /** Path under assets/ without extension — opaque region is the visible viz area. */
  mask: string;
  /** Optional frame overlay; white/keyed regions are transparent in the asset. */
  frame?: string;
  /** Optional inner content rect when viz/video is inset within the outer frame bounds. */
  contentInset?: FramedPanelInset;
  classPrefix?: string;
}

export interface FramedPanelInset {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Compact WMP-style playlist panel with source dropdown and track rows. */
export interface CompactPlaylistPresentation {
  kind: "compact";
  /** Show the source dropdown (All tracks, Up Next, user playlists). Default true. */
  showDropdown?: boolean;
  /** Show duration column. Default true. */
  showDuration?: boolean;
  classPrefix?: string;
}

export interface TextStyle {
  /** Theme token for color (`var(--{role})`). Omit when color is set in skin CSS. */
  role?: string;
  size?: "sm" | "md" | "lg";
  weight?: "normal" | "medium" | "semibold" | "bold";
  truncate?: boolean;
  /** When `truncate` is true: `bounce` (default) or seamless `marquee` loop. */
  scroll?: "bounce" | "marquee";
}

export interface WindowChrome {
  clipMask?: string;
  background?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  resizable?: boolean;
  /** When false, edge snapping is disabled for this skin. Default true. */
  snapEnabled?: boolean;
}

export type VisualizerPlacement = "top" | "bottom";
export type VisualizerDisplay = "mini" | "panel";
export type VisualizerSizeWidth = "fill" | number;
export type VisualizerSizeHeight = "flex" | "fill" | number;

export interface SkinVisualizerSize {
  width?: VisualizerSizeWidth;
  height?: VisualizerSizeHeight;
  minHeight?: number;
  maxHeight?: number;
}

export interface SkinVisualizer {
  /**
   * Viz pack id (folder under visualizers/), or `"global"` / omit to follow
   * the user's active visualizer picker.
   */
  pack?: string;
  /** @deprecated Use `pack`. Maps to built-in pack ids at runtime. */
  preset?: "bars" | "wave" | "spectrum";
  /** Band position in the skin shell. Default `bottom`. */
  placement?: VisualizerPlacement;
  /** `mini` = compact strip; `panel` = full slot with optional flex height. Default `mini`. */
  display?: VisualizerDisplay;
  size?: SkinVisualizerSize;
}

export type SkinActionId =
  | "player.togglePlayPause"
  | "player.previousTrack"
  | "player.nextTrack"
  | "player.cycleRepeat"
  | "player.toggleShuffle"
  | "player.seek"
  | "player.setVolume"
  | "player.setBalance"
  | "player.toggleMute"
  | "player.clearTrackList"
  | "navigation.openAlbum"
  | "queue.openTrackList"
  | "skin.openPicker"
  | "skin.exit"
  | "skin.minimize"
  | "skin.toggleAlwaysOnTop"
  | "skin.restoreMainWindow"
  | "skin.togglePanel"
  | "skin.openPanel"
  | "skin.closePanel"
  | "visualizer.previous"
  | "visualizer.next"
  | "playlist.setSource"
  | "playlist.playTrack"
  | "eq.setBand"
  | "eq.applyPreset"
  | "eq.reset"
  | "eq.setEnabled"
  | "app.quit";

export type SkinBindPath =
  | "track.title"
  | "track.artist"
  | "track.metadataLine"
  | "track.album"
  | "track.artUrl"
  | "track.durationSeconds"
  | "player.isPlaying"
  | "player.notPlaying"
  | "player.playbackState"
  | "player.positionSeconds"
  | "player.repeatMode"
  | "player.shuffle"
  | "player.volume"
  | "player.balance"
  | "player.muted"
  | "player.canGoPrevious"
  | "player.canGoNext"
  | "queue.length"
  | "player.hasTrack"
  | "skin.alwaysOnTop"
  | "playback.source"
  | "visualizer.name"
  | "visualizer.canGoPrevious"
  | "visualizer.canGoNext"
  | "playlist.sourceLabel"
  | "playlist.trackCount"
  | "playlist.hasTracks"
  | "eq.enabled"
  | "eq.presetId"
  | "eq.isManual"
  | "eq.presetLabel"
  | "eq.band.1"
  | "eq.band.2"
  | "eq.band.3"
  | "eq.band.4"
  | "eq.band.5"
  | "eq.band.6"
  | "eq.band.7"
  | "eq.band.8"
  | "eq.band.9"
  | "eq.band.10";
