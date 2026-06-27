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
  visualizer?: SkinVisualizer;
  animations?: unknown;
  timelines?: unknown;
  /** CSS file path relative to the skin pack root. */
  stylesheet?: string;
  /** Optional sound effect assets keyed by logical id (paths under assets/ without extension). */
  soundEffects?: Record<string, string>;
}

export type LayoutMode = "slots" | "canvas";

/** How the runtime infers window drag handles on canvas views. */
export type DragInference = "auto" | "manual";

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

export type SkinViewPresentation = "primary" | "exclusive" | "auxiliary";

export interface SkinView {
  /** How the runtime manages the native window for this view. */
  presentation?: SkinViewPresentation;
  /** `slots` (default) uses SkinShell regions; `canvas` uses absolute bounds. */
  layoutMode?: LayoutMode;
  /**
   * Window drag inference mode. Default `"auto"` for canvas views (stage-level
   * `deep` drag); `"manual"` for slots or when explicit drag flags are required.
   */
  dragInference?: DragInference;
  /** Logical size of the canvas stage when `layoutMode` is `canvas`. */
  canvas?: SkinCanvasSpec;
  /** In-view overlays toggled via `skin.togglePanel` (drawers, dropdowns). */
  panels?: Record<string, SkinPanel>;
  /** Ephemeral in-view variables (menu/content screens, etc.). */
  state?: Record<string, SkinViewStateSpec>;
  /** Effects run once when the skin-mode window becomes visible. */
  onActivate?: SkinViewActivateEffect[];
  /** Native window constraints and optional slots-mode background. */
  window?: WindowChrome;
  layout: LayoutNode;
}

export interface SkinViewStateSpec {
  default: string | number | boolean;
  /** Named transition events mapped to ordered branch lists. */
  on?: Record<string, SkinViewStateTransition[]>;
}

export interface SkinViewStateTransition {
  /** Current values that allow this branch (omit = any). */
  from?: Array<string | number | boolean>;
  set: string | number | boolean;
  /** Manifest soundEffects key played before set. */
  sound?: string;
}

export interface SkinViewActivateEffect {
  /** Bind path; effect runs only if truthy (same evaluator as visibleWhen). */
  when?: string;
  /** Wait after activate before dispatch (default 0). */
  delayMs?: number;
  action: string;
  payload?: SkinActionPayloadFields;
  /** Manifest soundEffects key played before the action. */
  sound?: string;
}

export interface LayoutBounds {
  /** Offset from the stage left edge. */
  x?: number;
  /** WMP-style right anchor: inset of the node's left edge from the stage right (`view.width - N`). */
  right?: number;
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
  | HitAreaNode
  | TiledFrameNode
  | SlideshowNode;

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

/** Solid canvas hit target without a Tauri drag attribute (e.g. click-through margins). */
export interface HitAreaNode extends NodeBase {
  type: "hitArea";
  bounds: LayoutBounds;
}

/** WMP-style 9-slice window frame that stretches on resize (pl/vis/info views). */
export interface TiledFrameNode extends NodeBase {
  type: "tiledFrame";
  presentation: TiledFramePresentation;
  children: LayoutNode[];
}

export interface TiledFrameAssets {
  topLeft: string;
  topCenter: string;
  topRight: string;
  topStretch: string;
  topStretch2?: string;
  leftStretch: string;
  rightStretch: string;
  bottomLeft: string;
  bottomCenter: string;
  bottomRight: string;
  bottomStretch: string;
  bottomStretch2?: string;
  resizeGrip?: string;
}

export interface TiledFrameTileSize {
  w: number;
  h: number;
  /** Visible chrome band height within the source asset; stretched to frameThickness at runtime. */
  artHeight?: number;
}

export interface TiledFrameTileSizes {
  topLeft: TiledFrameTileSize;
  topCenter: TiledFrameTileSize;
  topRight: TiledFrameTileSize;
  topStretch?: TiledFrameTileSize;
  topStretch2?: TiledFrameTileSize;
  leftStretch?: TiledFrameTileSize;
  rightStretch?: TiledFrameTileSize;
  bottomLeft: TiledFrameTileSize;
  bottomCenter: TiledFrameTileSize;
  bottomRight: TiledFrameTileSize;
  bottomStretch?: TiledFrameTileSize;
  bottomStretch2?: TiledFrameTileSize;
  resizeGrip?: TiledFrameTileSize;
}

export interface TiledFrameContentInset {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TiledFramePresentation {
  kind: "tiledFrame";
  assets: TiledFrameAssets;
  tileSizes: TiledFrameTileSizes;
  /** WMP top/bottom chrome band height (53 for plView). */
  frameThickness: number;
  /** Inner content area insets from the window edges. */
  contentInset: TiledFrameContentInset;
}

/** WMP-style image sequence paging (info promo decks). */
export interface SlideshowNode extends NodeBase {
  type: "slideshow";
  presentation: SlideshowPresentation;
}

export interface SlideshowPresentation {
  kind: "imageSequence";
  /** Asset path template under assets/ without extension; `{deckIndex}` and `{page}` placeholders. */
  assetPattern: string;
  decks: Record<string, SlideshowDeck>;
}

export interface SlideshowDeck {
  deckIndex: number;
  pages: number;
  /** When false, prev/next chrome is hidden (WMP trailer deck). Default true. */
  showPageNav?: boolean;
}

export interface ControlNodeBase extends NodeBase {
  action?: string;
  /** Target panel for `skin.*Panel` actions. */
  panelId?: string;
  /** Target view for `skin.*View` actions. */
  viewId?: string;
  /** Target URL for `app.openUrl`. */
  url?: string;
  /** Extra action payload merged at dispatch (e.g. view screen transitions). */
  payload?: SkinActionPayloadFields;
  bind?: string;
  disabledWhen?: string;
  /** When truthy, keep the pressed overlay (WMP sticky buttons). */
  activeWhen?: string;
  /** Manifest `soundEffects` key played on click. */
  sound?: string;
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
  /** Target view for `skin.*View` actions. */
  viewId?: string;
  /** Target URL for `app.openUrl`. */
  url?: string;
  /** When the bind is truthy, keep the pressed overlay (WMP sticky buttons). */
  activeWhen?: string;
  /** When truthy, the element is non-interactive (WMP disabled nav). */
  disabledWhen?: string;
  /** Manifest `soundEffects` key; overrides group-level `sound`. */
  sound?: string;
  /** Extra action payload merged at dispatch (e.g. slideshow deck id). */
  payload?: SkinActionPayloadFields;
}

/** Fields accepted on control nodes and button-group element payloads. */
export interface SkinActionPayloadFields {
  ratio?: number;
  volume?: number;
  balance?: number;
  albumKey?: string;
  panelId?: string;
  viewId?: string;
  sourceId?: string;
  trackId?: number;
  band?: number;
  gain?: number;
  enabled?: boolean;
  presetId?: string;
  url?: string;
  /** Slideshow node id for `slideshow.*` actions. */
  id?: string;
  deck?: string;
  /** View screen name for combined `slideshow.setDeck` + menu transitions. */
  screen?: string;
  /** Target view-state variable for `view.setVariable`. */
  variable?: string;
  /** Value to assign for `view.setVariable`. */
  value?: string | number | boolean;
  /** When set, `view.setVariable` only applies if the variable currently equals this. */
  when?: string | number | boolean;
  /** Named event for `view.applyStateEvent`. */
  event?: string;
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
  /** Manifest `soundEffects` key played on any element click in this group. */
  sound?: string;
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
  /**
   * Target loop duration in ms. Scales frame timing to match (all frames kept).
   * When set with `completeAction`, the action fires after one scaled loop.
   */
  durationMs?: number;
  /**
   * Multiplier on native frame delays (`1` = file timing, `0.5` = half speed).
   * Ignored when `durationMs` is set.
   */
  playbackRate?: number;
  /** Action dispatched after the first scaled animation loop completes. */
  completeAction?: string;
  /** Payload merged when `completeAction` fires (e.g. `view.setVariable`). */
  completePayload?: SkinActionPayloadFields;
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
  /**
   * When true, the track image is a bottom-anchored value fill (WMP
   * `foregroundImage`) revealed up to the current value, rather than a static
   * track. The empty groove is expected in the window background.
   */
  fillFromBottom?: boolean;
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
  align?: "left" | "center" | "right";
}

export interface WindowChrome {
  clipMask?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  resizable?: boolean;
  /** When false, edge snapping is disabled for this view. Default true. */
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
  | "player.play"
  | "player.pause"
  | "player.previousTrack"
  | "player.nextTrack"
  | "player.cycleRepeat"
  | "player.toggleRepeat"
  | "player.toggleShuffle"
  | "player.seek"
  | "player.seekForward"
  | "player.seekBackward"
  | "player.volumeUp"
  | "player.volumeDown"
  | "player.setVolume"
  | "player.setBalance"
  | "player.toggleMute"
  | "player.clearSetList"
  | "navigation.openAlbum"
  | "queue.openSetList"
  | "skin.openPicker"
  | "skin.exit"
  | "skin.minimize"
  | "skin.toggleAlwaysOnTop"
  | "skin.restoreMainWindow"
  | "skin.togglePanel"
  | "skin.openPanel"
  | "skin.closePanel"
  | "skin.switchView"
  | "skin.openView"
  | "skin.closeView"
  | "skin.toggleView"
  | "skin.toggleSoundEffects"
  | "visualizer.previous"
  | "visualizer.next"
  | "playlist.setSource"
  | "playlist.playTrack"
  | "eq.setBand"
  | "eq.applyPreset"
  | "eq.reset"
  | "eq.setEnabled"
  | "eq.previousPreset"
  | "eq.nextPreset"
  | "app.quit"
  | "app.openUrl"
  | "app.openFile"
  | "view.setScreen"
  | "view.setVariable"
  | "view.applyStateEvent"
  | "slideshow.setDeck"
  | "slideshow.prev"
  | "slideshow.next";

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
  | "player.positionLabel"
  | "player.repeatMode"
  | "player.repeatOn"
  | "player.shuffle"
  | "player.volume"
  | "player.balance"
  | "player.muted"
  | "player.canGoPrevious"
  | "player.canGoNext"
  | "queue.length"
  | "player.hasTrack"
  | "skin.alwaysOnTop"
  | "skin.pref.soundEffectsEnabled"
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
