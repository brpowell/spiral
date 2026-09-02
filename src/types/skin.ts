/** Mirrors Rust `SkinManifest` / layout types (skin.json). */

import type { PackZone } from "./pack";

/** Pack-relative path under assets/, including extension (e.g. buttons/play.png). */
export type SkinAssetFile = string;

export type InteractiveAssetState =
  "default" | "hover" | "pressed" | "disabled";

/** Default / hover / pressed / disabled bitmap states for interactive controls. */
export interface InteractiveAssets {
  default: SkinAssetFile;
  hover?: SkinAssetFile;
  pressed?: SkinAssetFile;
  disabled?: SkinAssetFile;
}

/** Slider thumb sprite set. `default` is WMP `thumbImage`; hover / pressed map `thumbHoverImage` / `thumbDownImage`. */
export interface ThumbAssets {
  default: SkinAssetFile;
  hover?: SkinAssetFile;
  pressed?: SkinAssetFile;
}

/** Bind path → asset set when truthy (last match wins, same as tooltipWhen). */
export type InteractiveAssetsWhen = Record<string, InteractiveAssets>;

/**
 * Boolean composition of skin bind paths for guards (`visibleWhen`,
 * `enabledWhen`, click `when`) and overlay-row `when`.
 * A plain string is a leaf bind (truthy when evaluated value is truthy).
 * A boolean is a constant (use `false` for controls that are never interactive).
 */
export type SkinCondition =
  | boolean
  | string
  | { all: SkinCondition[] }
  | { any: SkinCondition[] }
  | { not: SkinCondition };

/** Overlay row: `when` is a {@link SkinCondition}; remaining fields are the patch. */
export type WhenOverlay<T> = T & { when: SkinCondition };

/**
 * Bind map (legacy) or ordered list of {@link WhenOverlay} rows.
 * List order is last-match-wins. A map key is a leaf bind path.
 */
export type WhenMapOrList<T> = Record<string, T> | WhenOverlay<T>[];

export interface SkinSummary {
  id: string;
  name: string;
  author: string;
  description: string;
  isBuiltin: boolean;
  packId: string;
  packName: string;
  packVersion: string;
  zone: PackZone;
  previewPath: string | null;
}

export interface LoadedSkinPack {
  summary: SkinSummary;
  packDir: string;
  manifest: SkinManifest;
}

export interface SkinManifest {
  /** Declared contribution id (kebab slug). */
  id: string;
  name: string;
  author: string;
  description: string;
  /** Optional preview image path relative to the contribution directory. Raster only (png/jpg/jpeg/webp/gif). */
  preview?: string;
  views: Record<string, SkinView>;
  visualizer?: SkinVisualizer;
  animations?: unknown;
  timelines?: unknown;
  /** CSS file path relative to the skin pack root. */
  stylesheet?: string;
  /** Optional sound effect assets keyed by logical id (paths under assets/ without extension). */
  soundEffects?: Record<string, string>;
  /** Author-defined user preferences (persisted under custom in skin-preferences.json). */
  settings?: SkinSetting[];
}

/** Boolean author preference declared in `settings`. */
export interface SkinSetting {
  id: string;
  name: string;
  description?: string;
  type: "boolean";
  default: boolean;
}

/** How the runtime infers window drag handles on canvas views. */
export type DragInference = "auto" | "manual";

export type SkinViewPresentation = "primary" | "exclusive" | "auxiliary";

export interface SkinView {
  /** How the runtime manages the native window for this view. Omit on a single-view skin. */
  presentation?: SkinViewPresentation;
  /**
   * Window drag inference mode. Default `"auto"` for canvas views (stage-level
   * `deep` drag); `"manual"` for flow or when explicit drag flags are required.
   */
  dragInference?: DragInference;
  /** Ephemeral in-view variables (menu/content screens, drawers, etc.). */
  state?: Record<string, SkinViewStateSpec>;
  /** Effects run once when the skin-mode window becomes visible. */
  onActivate?: SkinLifecycleEffect[];
  /** Native window constraints. */
  window?: WindowChrome;
  layout: ViewLayout;
}

export interface SkinViewStateSpec {
  default: string | number | boolean;
  /** Named transition events mapped to ordered branch lists. */
  on?: Record<string, SkinViewStateTransition[]>;
}

/** CSS timing functions the host interpolator / `.skin-bounds--motion` accept. */
export type SkinTransitionEasing =
  "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";

/**
 * Host-driven interpolation when resolved bounds (or later, a view-state change)
 * retarget. Omit, or `durationMs: 0`, to snap.
 */
export interface SkinLayoutTransition {
  durationMs: number;
  easing?: SkinTransitionEasing;
}

export interface SkinViewStateTransition {
  /** Current values that allow this branch (omit = any). */
  from?: Array<string | number | boolean>;
  set: string | number | boolean;
  /**
   * Same object as node `transition`. Reserved for the host interpolator;
   * today's CSS path reads `transition` on the layout node.
   */
  transition?: SkinLayoutTransition;
}

export interface SkinClickEffect {
  /** Condition; effect runs only when truthy (same evaluator as visibleWhen). */
  when?: SkinCondition;
  /** Wait before dispatch (default 0). */
  delayMs?: number;
  action?: string;
  payload?: SkinActionPayloadFields;
  /** Manifest soundEffects key played when the effect fires (before the action). */
  sound?: string;
}

export type SkinLifecycleEffect = SkinClickEffect;

export interface LayoutBounds {
  /** Offset from the context left edge. */
  x?: number;
  /**
   * Inset of the node's right edge from the context right (CSS).
   * With `x` and no `w`: horizontal stretch. With `w` and no `x`: right-anchored fixed width.
   */
  right?: number;
  y?: number;
  /**
   * Inset of the node's bottom edge from the context bottom (CSS).
   * With `y` and no `h`: vertical stretch. With `h` and no `y`: bottom-anchored fixed height.
   */
  bottom?: number;
  w?: number;
  h?: number;
  zIndex?: number;
}

export type ViewLayout = CanvasNode | RowNode | ColumnNode;

/** View root or any descendant. Walkers that start at `view.layout` take this. */
export type LayoutTreeNode = CanvasNode | LayoutNode;

export type LayoutNode =
  | RowNode
  | ColumnNode
  | OverlayNode
  | SubviewNode
  | DecorationNode
  | ButtonNode
  | ButtonGroupNode
  | TextNode
  | InputNode
  | ArtworkNode
  | TransportNode
  | VisualizerNode
  | RatingNode
  | SliderNode
  | TimeNode
  | PlaylistNode
  | TiledFrameNode
  | SlideshowNode
  | ScrollStripNode;

interface NodeBase {
  id?: string;
  /** Optional CSS class on the node root. Prefer `id` for one-off targeting. */
  className?: string;
  /** Closed panel-writable paint. Omitting a field cedes it to CSS. */
  style?: NodeStyle;
  /**
   * Style overlays when a condition is truthy (last match wins, shallow merge).
   * Bind map or ordered `{ when, …style }` list.
   */
  styleWhen?: WhenMapOrList<NodeStyle>;
  visibleWhen?: SkinCondition;
  /** Absolute placement on a canvas view (logical px). */
  bounds?: LayoutBounds;
  /**
   * Override `bounds` when a condition is true (`state.*`, `hover.*`, or a
   * composed {@link SkinCondition} in list form).
   */
  boundsWhen?: WhenMapOrList<Partial<LayoutBounds>>;
  /**
   * Interpolate when resolved bounds change. Omit (or `durationMs: 0`) to snap.
   * Presence of `boundsWhen` does not imply motion.
   */
  transition?: SkinLayoutTransition;
  /**
   * Transition overlays when a condition is truthy (last match wins, shallow
   * merge). Bind map or ordered `{ when, …transition }` list.
   */
  transitionWhen?: WhenMapOrList<SkinLayoutTransition>;
  /**
   * Effects when `hover.{id}` goes false (pointer leave or hide/unmount).
   * Same shape as `onClick`. Requires `id`.
   */
  onHoverLeave?: SkinClickEffect[];
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

export interface CanvasNode {
  type: "canvas";
  id?: string;
  className?: string;
  style?: NodeStyle;
  styleWhen?: WhenMapOrList<NodeStyle>;
  width: number;
  height: number;
  children: LayoutNode[];
  visibleWhen?: SkinCondition;
  dragRegion?: boolean;
  transition?: SkinLayoutTransition;
  transitionWhen?: WhenMapOrList<SkinLayoutTransition>;
}

/**
 * Bounded nested group (WMS subview). Parent-relative `bounds` required.
 * Not valid as a view layout root — use `canvas`, `row`, or `column`.
 */
export interface SubviewNode extends NodeBase {
  type: "subview";
  bounds: LayoutBounds;
  children: LayoutNode[];
  /**
   * When true, the group’s bounds box does not clip overflow (alpha-fringed
   * frames). Group boxes already ignore pointer events; children still receive
   * them. Matches WMS passthrough subviews.
   */
  passthrough?: boolean;
  /** When true, pointer events on empty group space move the skin window. */
  dragRegion?: boolean;
}

export interface DecorationNode extends NodeBase {
  type: "decoration";
  presentation: Presentation;
  /** When true on a canvas view, this decoration is a window drag handle. */
  dragRegion?: boolean;
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

/** Explicit WMP-style frame tile (subview equivalent). */
export interface TiledFrameTileDef {
  asset: string;
  bounds: LayoutBounds;
  repeat?: "horizontal" | "vertical";
  tileUnit?: { w: number; h: number };
  /** Visible chrome band height within the source asset; stretched to display band at runtime. */
  artHeight?: number;
  zIndex?: number;
}

/** WMP 9-slice preset generated at runtime from assets + tileSizes. */
export interface TiledFramePresetPresentation {
  kind: "tiledFrame";
  contentInset: TiledFrameContentInset;
  assets: TiledFrameAssets;
  tileSizes: TiledFrameTileSizes;
  /** WMP top/bottom chrome band height (53 for plView). */
  frameThickness: number;
  /** Round the content pane and matching chrome clip hole, in px. */
  contentCornerRadius?: number;
}

/** Declarative multi-layer frame (stacked WMP subviews). */
export interface TiledFrameExplicitPresentation {
  kind: "tiledFrame";
  contentInset: TiledFrameContentInset;
  tiles: TiledFrameTileDef[];
  /** Round the content pane and matching chrome clip hole, in px. */
  contentCornerRadius?: number;
}

export type TiledFramePresentation =
  TiledFramePresetPresentation | TiledFrameExplicitPresentation;

export function isTiledFrameExplicit(
  presentation: TiledFramePresentation,
): presentation is TiledFrameExplicitPresentation {
  return "tiles" in presentation && Array.isArray(presentation.tiles);
}

/** WMP-style image sequence paging (info promo decks). */
export interface SlideshowNode extends NodeBase {
  type: "slideshow";
  presentation: SlideshowPresentation;
}

export interface SlideshowPresentation {
  kind: "imageSequence";
  /** Asset path template under assets/ with extension; `{deckIndex}` and `{page}` placeholders. */
  assetPattern: string;
  decks: Record<string, SlideshowDeck>;
}

export interface SlideshowDeck {
  deckIndex: number;
  pages: number;
  /** When false, prev/next chrome is hidden (WMP trailer deck). Default true. */
  showPageNav?: boolean;
}

/** WMP-style vertically animated bitmap text columns (XBOX content promos). */
export interface ScrollStripNode extends NodeBase {
  type: "scrollStrip";
  presentation: ScrollStripPresentation;
}

export interface ScrollStripPresentation {
  kind: "bitmapVertical";
  /** Slide transition duration in ms (WMP moveTo default 500). */
  transitionMs?: number;
  items: ScrollStripItem[];
  /**
   * Per-slide item Y positions (stage-absolute px, same as WMP subview top).
   * Runtime subtracts the strip’s absolute origin (parent chain + local bounds).
   */
  slides: ScrollStripSlide[];
}

export interface ScrollStripItem {
  id: string;
  asset: SkinAssetFile;
  w: number;
  h: number;
}

export interface ScrollStripSlide {
  items: Record<string, { y: number }>;
}

export interface ControlNodeBase extends NodeBase {
  /** Ordered click effects. Immediate click wavs stay on `sound` / `soundWhen`. */
  onClick?: SkinClickEffect[];
  bind?: string;
  /** When truthy, the control is interactive. */
  enabledWhen?: SkinCondition;
  /** When truthy, keep the pressed overlay (WMP sticky buttons). */
  activeWhen?: SkinCondition;
  /** Manifest `soundEffects` key played on click. */
  sound?: string;
  /** Bind path → soundEffects key when truthy (last match wins). */
  soundWhen?: Record<string, string>;
  /** OS tooltip text; supports `{bind.path}` placeholders. */
  tooltip?: string;
  /** Bind path → tooltip when truthy (last match wins). */
  tooltipWhen?: Record<string, string>;
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
  onClick?: SkinClickEffect[];
  /** When the bind is truthy, keep the pressed overlay (WMP sticky buttons). */
  activeWhen?: SkinCondition;
  /** When truthy, the element is interactive. */
  enabledWhen?: SkinCondition;
  /** Manifest `soundEffects` key; overrides group-level `sound`. */
  sound?: string;
  /** Bind path → soundEffects key when truthy (last match wins). */
  soundWhen?: Record<string, string>;
  /** OS tooltip text; supports `{bind.path}` placeholders. */
  tooltip?: string;
  /** Bind path → tooltip when truthy (last match wins). */
  tooltipWhen?: Record<string, string>;
}

/** Fields accepted on control nodes and button-group element payloads. */
export interface SkinActionPayloadFields {
  ratio?: number;
  volume?: number;
  balance?: number;
  albumKey?: string;
  viewId?: string;
  sourceId?: string;
  trackId?: number;
  /** Current input string for `playlist.setFilter` (host-injected on `onChange`). */
  query?: string;
  band?: number;
  gain?: number;
  enabled?: boolean;
  presetId?: string;
  url?: string;
  /** Slideshow / scrollStrip node id for `slideshow.*` / `scrollStrip.*` actions. */
  id?: string;
  deck?: string;
  /** Target slide for `scrollStrip.setSlide`. */
  slide?: number;
  /** View screen name for combined `slideshow.setDeck` + menu transitions. */
  screen?: string;
  /** Target view-state variable for `state.setVariable`. */
  variable?: string;
  /** Value for `state.setVariable` or `skin.setPref`. */
  value?: string | number | boolean;
  /** When set, `state.setVariable` only applies if the variable currently equals this. */
  when?: string | number | boolean;
  /** Named event for `state.applyEvent`. */
  event?: string;
  /** Target setting for `skin.togglePref` / `skin.setPref`. */
  settingId?: string;
}

export interface ButtonGroupPresentation {
  kind: "buttonGroup";
  assets: InteractiveAssets;
  assetsWhen?: InteractiveAssetsWhen;
  positionMap: SkinAssetFile;
  width?: number;
  height?: number;
  /** Manifest `soundEffects` key played on any element click in this group. */
  sound?: string;
  /**
   * Co-elevate this group when any listed overlapping group is hovered or pressed.
   * Use when a sibling overlay (e.g. pause) must stay painted above part of the
   * active group's composite artwork (e.g. play+stop sheet).
   */
  elevateWhen?: string[];
  elements: ButtonGroupElement[];
}

export interface ArtworkNode extends ControlNodeBase {
  type: "artwork";
  /** CSS object-fit for the cover image. Default `cover`. */
  objectFit?: "cover" | "contain" | "fill";
}

export interface TransportNode extends ControlNodeBase {
  type: "transport";
}

export interface VisualizerNode extends ControlNodeBase {
  type: "visualizer";
}

export interface RatingNode extends ControlNodeBase {
  type: "rating";
}

/** What a slider writes. Omit for decorative/unbound thumbs. */
export type SliderControl = "volume" | "seek" | "balance" | "eq";

interface SliderNodeBase extends ControlNodeBase {
  type: "slider";
}

/** Decorative or unbound slider — no host write path. */
export interface SliderUnboundNode extends SliderNodeBase {
  control?: undefined;
}

export interface SliderVolumeNode extends SliderNodeBase {
  control: "volume";
}

export interface SliderSeekNode extends SliderNodeBase {
  control: "seek";
}

export interface SliderBalanceNode extends SliderNodeBase {
  control: "balance";
}

export interface SliderEqNode extends SliderNodeBase {
  control: "eq";
  /** 1-based band index (1 = 31 Hz … 10 = 16 kHz). */
  band: number;
  /**
   * Linear tilt control point. All `control: "eq"` nodes with `spread: "linear"`
   * in the skin are endpoints; dragging one interpolates the other 10-band gains.
   */
  spread?: "linear";
}

/** Bitmap / strip / primitive slider. Discriminate on `control`. */
export type SliderNode =
  | SliderUnboundNode
  | SliderVolumeNode
  | SliderSeekNode
  | SliderBalanceNode
  | SliderEqNode;

export interface TimeNode extends ControlNodeBase {
  type: "time";
}

export interface PlaylistNode extends NodeBase {
  type: "playlist";
  /**
   * What the list shows. Default `tracks`. `sources` is a source picker
   * (WMP `<listbox>` of Now Playing / user playlists) — no track rows.
   */
  items?: "tracks" | "sources";
  /** Show the source dropdown (All tracks, Up Next, user playlists). Default true. Ignored when `items` is `sources`. */
  showDropdown?: boolean;
  /** Show duration column. Default true. */
  showDuration?: boolean;
  /** Show album artwork on each track row. Default false. */
  showArtwork?: boolean;
  /** Initial source (`all` or `upNext`). Default `all`. */
  defaultSource?: "all" | "upNext";
  /** Panel-writable paint for the playing track row (`__row--playing`). */
  playingRowStyle?: NodeStyle;
  /** Panel-writable paint for the current track row (`__row--current`). */
  currentRowStyle?: NodeStyle;
  /** Panel-writable paint for the source dropdown (`__source`). */
  sourceStyle?: NodeStyle;
  /** Panel-writable paint for the source dropdown while hovered. Merged on top of `sourceStyle`. */
  sourceHoverStyle?: NodeStyle;
  /**
   * Panel-writable paint for a track row while hovered. Merged under
   * `currentRowStyle` / `playingRowStyle` when those also apply.
   */
  rowHoverStyle?: NodeStyle;
}

export type TextOverflow = "visible" | "clip" | "scroll" | "scroll-bounce";

export interface TextNode extends NodeBase {
  type: "text";
  bind?: string;
  /** Static label when `bind` is omitted. */
  value?: string;
  /**
   * Runtime overflow behavior. Typography (size, color, weight, align) lives
   * in `style`; omitting a field cedes it to CSS.
   */
  overflow?: TextOverflow;
}

/**
 * Editable text field. No `presentation` — native input. `onChange` effects
 * receive the current string as `payload.query`.
 */
export interface InputNode extends NodeBase {
  type: "input";
  placeholder?: string;
  maxLength?: number;
  enabledWhen?: SkinCondition;
  onChange?: SkinClickEffect[];
}

/** Closed panel-writable paint. Numbers are px. */
export interface NodeStyle {
  color?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold" | number;
  textAlign?: "left" | "center" | "right";
  backgroundColor?: string;
  /** 0–1. Interpolates with node `transition` when `styleWhen` retargets it. */
  opacity?: number;
}

export type Presentation =
  | BitmapPresentation
  | GifPresentation
  | PrimitivePresentation
  | CssPresentation
  | StripSliderPresentation
  | BitmapVerticalSliderPresentation
  | BitmapHorizontalSliderPresentation
  | DigitStripPresentation
  | FramedPanelPresentation;

export interface BitmapPresentation {
  kind: "bitmap";
  assets: InteractiveAssets;
  assetsWhen?: InteractiveAssetsWhen;
  width?: number;
  height?: number;
}

/** Animated GIF under assets/. Pixels must already have alpha baked in. */
export interface GifPresentation {
  kind: "gif";
  asset: SkinAssetFile;
  /**
   * Target loop duration in ms. Scales frame timing to match (all frames kept).
   * When set with `onComplete`, those effects fire after one scaled loop.
   */
  durationMs?: number;
  /**
   * Multiplier on native frame delays (`1` = file timing, `0.5` = half speed).
   * Ignored when `durationMs` is set.
   */
  playbackRate?: number;
  /** Effects dispatched after the first scaled animation loop completes. */
  onComplete?: SkinLifecycleEffect[];
}

/** Primitive `button` chrome. App Button variants, or `plain` (no hover fill). Default: ghost. */
export type PrimitiveButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "plain";

export interface PrimitivePresentation {
  kind: "primitive";
  /**
   * Button only. Spiral icon library id (`setList` → `IconSetList`) or
   * pack-relative raster under `assets/` (e.g. `icons/foo.png`).
   */
  icon?: string;
  /** Button only. Visible label (author content). */
  text?: string;
  /** Button only. App Button variant, or `plain` for a chrome-less hit target. Default ghost. */
  variant?: PrimitiveButtonVariant;
}

export interface CssPresentation {
  kind: "css";
  className: string;
  stylesheet?: string;
}

/** WMP-style tiled vertical track + movable thumb (EQ bands, volume). */
export interface BitmapVerticalSliderPresentation {
  kind: "bitmapVerticalSlider";
  /** Omitted for thumb-only sliders (groove baked into panel background). */
  track?: SkinAssetFile;
  /** Value fill clipped to the thumb center from the bottom (WMP `foregroundImage`). */
  fill?: SkinAssetFile;
  thumb: ThumbAssets;
  /** Source tile width in px (WMP backgroundImage width). Required when `track` is set. */
  trackTileWidth?: number;
  /** Source tile height in px; when less than trackHeight, runtime 3-slice tiling applies. */
  trackTileHeight?: number;
  trackWidth: number;
  trackHeight: number;
  thumbWidth: number;
  thumbHeight: number;
  /** Cap size for track tiling and thumb *center* travel inset (WMP borderSize). */
  borderSize?: number;
}

/** WMP-style tiled horizontal track + movable thumb (slider controls). */
export interface BitmapHorizontalSliderPresentation {
  kind: "bitmapHorizontalSlider";
  /** Omitted for thumb-only sliders (groove baked into panel background). */
  track?: SkinAssetFile;
  /** Value fill clipped to the thumb center from the left (WMP `foregroundImage`). */
  fill?: SkinAssetFile;
  thumb: ThumbAssets;
  /** Source tile width in px. Required when `track` is set. */
  trackTileWidth?: number;
  /** Source tile height in px. Required when `track` is set. */
  trackTileHeight?: number;
  trackWidth: number;
  trackHeight: number;
  thumbWidth: number;
  thumbHeight: number;
  borderSize?: number;
}

/** WMP-style filmstrip slider: one frame per discrete value step. */
export interface StripSliderPresentation {
  kind: "stripSlider";
  strip: SkinAssetFile;
  /** Optional position map for non-linear hit testing (WMP positionImage). */
  positionMap?: SkinAssetFile;
  frameWidth: number;
  frameHeight?: number;
  frameCount: number;
  direction?: "horizontal" | "vertical";
  /** How normalized value maps to strip frame indices (default ascending). */
  valueFrames?: "ascending" | "descending";
  /** How position-map samples map to frames (luminance for grayscale ramps; axis position otherwise). */
  mapFrames?: "ascending" | "descending";
}

/** WMP-style horizontal digit strip for MM:SS (and sign) display. */
export interface DigitStripPresentation {
  kind: "digitStrip";
  strip: SkinAssetFile;
  frameWidth: number;
  frameHeight: number;
  /** Digit/sign windows within the control bounds (logical px). */
  slots: DigitStripSlot[];
  /** Strip frame index for elapsed-mode separator (default 10). */
  signFrameElapsed?: number;
  /** Strip frame index for remaining-mode prefix (default 11). */
  signFrameRemaining?: number;
}

export interface DigitStripSlot {
  role: "sign" | "minuteTens" | "minuteOnes" | "secondTens" | "secondOnes";
  x: number;
}

/** WMP-style viz panel: bitmap mask clip + optional frame overlay (vid_bkgd pattern). */
export interface FramedPanelPresentation {
  kind: "framedPanel";
  mask: SkinAssetFile;
  frame?: SkinAssetFile;
  /** Optional inner content rect when viz/video is inset within the outer frame bounds. */
  contentInset?: FramedPanelInset;
}

export interface FramedPanelInset {
  x: number;
  y: number;
  w: number;
  h: number;
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

export interface SkinVisualizer {
  /**
   * Effective visualizer contribution id (`authorId.packId.type.contributionId`),
   * or `"global"` / omit to follow the user's active visualizer picker.
   * Skins always render the full panel surface; mini+expand lives on the library
   * Now Playing bar only.
   */
  id?: string;
}

export type SkinActionId =
  | "player.togglePlayPause"
  | "player.play"
  | "player.pause"
  | "player.stop"
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
  | "player.toggleCrossfade"
  | "navigation.openAlbum"
  | "skin.openPicker"
  | "skin.exit"
  | "skin.minimize"
  | "skin.toggleAlwaysOnTop"
  | "skin.restoreMainWindow"
  | "skin.switchView"
  | "skin.openView"
  | "skin.closeView"
  | "skin.toggleView"
  | "skin.toggleSoundEffects"
  | "skin.togglePref"
  | "skin.setPref"
  | "visualizer.previous"
  | "visualizer.next"
  | "playlist.setSource"
  | "playlist.playTrack"
  | "playlist.setFilter"
  | "eq.setBand"
  | "eq.applyPreset"
  | "eq.reset"
  | "eq.setEnabled"
  | "eq.previousPreset"
  | "eq.nextPreset"
  | "app.quit"
  | "app.openUrl"
  | "app.openFile"
  | "state.setVariable"
  | "state.applyEvent"
  | "slideshow.setDeck"
  | "slideshow.prev"
  | "slideshow.next"
  | "scrollStrip.prev"
  | "scrollStrip.next"
  | "scrollStrip.setSlide";

export type SkinBindPath =
  | "track.title"
  | "track.artist"
  | "track.metadataLine"
  | "track.album"
  | "track.artUrl"
  | "track.durationSeconds"
  | "track.rating"
  | "player.isPlaying"
  | "player.notPlaying"
  | "player.playbackState"
  | "player.positionSeconds"
  | "player.positionLabel"
  | "player.durationLabel"
  | "player.remainingLabel"
  | "player.volumePercent"
  | "player.repeatMode"
  | "player.repeatOn"
  | "player.shuffle"
  | "player.crossfadeEnabled"
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
  | "playlist.filterQuery"
  | "playlist.hasFilter"
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
