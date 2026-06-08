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
}

export interface SkinView {
  /** `slots` (default) uses SkinShell regions; `canvas` uses absolute bounds. */
  layoutMode?: LayoutMode;
  /** Logical size of the canvas stage when `layoutMode` is `canvas`. */
  canvas?: SkinCanvasSpec;
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
  | QueueNode
  | TimeNode
  | DragRegionNode;

interface NodeBase {
  id?: string;
  visibleWhen?: string;
  /** Absolute placement on a canvas view (logical px). */
  bounds?: LayoutBounds;
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

export interface QueueNode extends ControlNodeBase {
  type: "queue";
}

export interface TimeNode extends ControlNodeBase {
  type: "time";
}

export interface TextNode extends NodeBase {
  type: "text";
  bind?: string;
  textStyle?: string;
  presentation: Presentation;
}

export type Presentation =
  | BitmapPresentation
  | GifPresentation
  | PrimitivePresentation
  | CssPresentation
  | StripSliderPresentation
  | DigitStripPresentation;

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
  preset: "bars" | "wave" | "spectrum";
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
  | "player.toggleMute"
  | "player.clearTrackList"
  | "navigation.openAlbum"
  | "queue.openTrackList"
  | "skin.openPicker"
  | "skin.exit"
  | "skin.minimize"
  | "skin.toggleAlwaysOnTop"
  | "skin.restoreMainWindow"
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
  | "player.muted"
  | "player.canGoPrevious"
  | "player.canGoNext"
  | "queue.length"
  | "player.hasTrack"
  | "skin.alwaysOnTop";
