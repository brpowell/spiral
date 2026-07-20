# Playback skin contract

Shared playback UI lives under `src/components/playback/` (`PlaybackTransport`, `NowPlayingMetadata`, `SeekBar`, `VolumeControl`, `QueueButton`, `VisualizerSlot`) and composes through `SkinShell` slot wrappers. Import from `src/components/playback` (barrel) or individual subfolders.

V1 components read `usePlayerStore` directly. **V2:** skin mode uses manifests (`skin.json` v1) that bind to the action catalog and data paths below via `SkinLayoutRenderer` — see `src/components/playback/skin/` and `src-tauri/schemas/skin-v1.schema.json`.

## Action catalog

Named actions invoked by shared playback components. Skin authors wire controls to these identifiers.


| Action ID                 | Description                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `player.togglePlayPause`  | Toggle play/pause for the current track                                                                                      |
| `player.play`             | Start or resume playback for the current track                                                                               |
| `player.pause`            | Pause playback when playing                                                                                                  |
| `player.previousTrack`    | Go to previous track                                                                                                         |
| `player.nextTrack`        | Go to next track                                                                                                             |
| `player.cycleRepeat`      | Cycle repeat mode: off → all → one                                                                                           |
| `player.toggleRepeat`     | Toggle playlist repeat on/off (no repeat-one)                                                                                |
| `player.toggleShuffle`    | Toggle shuffle                                                                                                               |
| `player.seek`             | Seek to ratio 0–1 (payload: `{ ratio: number }`)                                                                             |
| `player.setVolume`        | Set volume 0–1 (payload: `{ volume: number }`)                                                                               |
| `player.setBalance`       | Set stereo balance −1…1 (payload: `{ balance: number }`; 0 = center)                                                         |
| `player.toggleMute`       | Toggle mute                                                                                                                  |
| `player.clearSetList`     | Stop playback and clear the set list (same as the set list modal Clear action)                                               |
| `navigation.openAlbum`    | Open album view for current track (payload: `{ albumKey: string }`)                                                          |
| `queue.openSetList`       | Open the set list modal                                                                                                      |
| `skin.openPicker`         | Open Studio (Skins section)                                                                                                  |
| `skin.exit`               | Exit skin mode                                                                                                               |
| `skin.restoreMainWindow`  | Hide skin mode and show the library window                                                                                   |
| `skin.minimize`           | Minimize the skin-mode window                                                                                                |
| `skin.toggleAlwaysOnTop`  | Toggle always-on-top for the skin window                                                                                     |
| `skin.togglePanel`        | Toggle an in-view panel (payload: `{ panelId: string }` on the control node)                                                 |
| `skin.openPanel`          | Open an in-view panel                                                                                                        |
| `skin.closePanel`         | Close an in-view panel                                                                                                       |
| `skin.switchView`         | Switch the primary skin window to an exclusive view (payload: `{ viewId: string }`)                                          |
| `skin.openView`           | Open an auxiliary view window (payload: `{ viewId: string }`)                                                                |
| `skin.closeView`          | Close an auxiliary view window (payload: `{ viewId?: string }`; defaults to the current aux window)                          |
| `skin.toggleView`         | Toggle an auxiliary view window open/closed (payload: `{ viewId: string }`)                                                  |
| `skin.toggleSoundEffects` | Toggle skin sound effects for the active skin (no-op when manifest has no `soundEffects`)                                    |
| `visualizer.previous`     | Cycle to the previous global visualizer                                                                                      |
| `visualizer.next`         | Cycle to the next global visualizer                                                                                          |
| `playlist.setSource`      | Select playlist view source (payload: `{ sourceId: string }` — `all`, `upNext`, or `playlist:{id}`)                          |
| `playlist.playTrack`      | Play a track from the active playlist view (payload: `{ trackId: number }`)                                                  |
| `eq.setBand`              | Set EQ band gain (payload: `{ band: number; gain: number }` — **band is 1-based**, gain in dB −14…+14; forces manual preset) |
| `eq.applyPreset`          | Apply a named preset (payload: `{ presetId: string }`)                                                                       |
| `eq.reset`                | Flatten all bands to 0 dB and set preset to manual                                                                           |
| `eq.setEnabled`           | Toggle EQ processing (payload: `{ enabled: boolean }`; band values preserved when disabled)                                  |
| `eq.previousPreset`       | Cycle to the previous EQ preset (built-ins, then custom)                                                                     |
| `eq.nextPreset`           | Cycle to the next EQ preset                                                                                                  |
| `app.quit`                | Quit Spiral (saves session and closes the app)                                                                               |
| `app.openUrl`             | Open an external URL in the system browser (payload: `{ url: string }`)                                                      |
| `app.openFile`            | Open the library import picker and import selected audio files or folders                                                    |




## Data bind paths

Read-only paths for skin text, visibility, and interaction guards (`visibleWhen`, `enabledWhen`). No scripting in V1/V2.


| Bind path                  | Type                               | Description                                          |
| -------------------------- | ---------------------------------- | ---------------------------------------------------- |
| `track.title`              | `string`                           | Current track title                                  |
| `track.artist`             | `string | null`                    | Primary artist                                       |
| `track.metadataLine`       | `string`                           | `{status} - {artist} - {title}` (scrolling-friendly) |
| `track.album`              | `string | null`                    | Album name                                           |
| `track.artUrl`             | `string | null`                    | Resolved album art URL                               |
| `track.durationSeconds`    | `number | null`                    | Track duration                                       |
| `player.isPlaying`         | `boolean`                          | `playbackState === "playing"`                        |
| `player.notPlaying`        | `boolean`                          | `playbackState !== "playing"`                        |
| `player.playbackState`     | `"playing" | "paused" | "stopped"` | Raw playback state                                   |
| `player.positionSeconds`   | `number`                           | Store position (use hook for live scrubber)          |
| `player.positionLabel`     | `string`                           | Elapsed time formatted `m:ss`                        |
| `player.durationLabel`     | `string`                           | Track duration formatted `m:ss`                      |
| `player.remainingLabel`    | `string`                           | Remaining time formatted `-m:ss`                     |
| `player.volumePercent`     | `number`                           | Volume as integer 0–100                              |
| `player.repeatMode`        | `"off" | "all" | "one"`            | Repeat mode                                          |
| `player.shuffle`           | `boolean`                          | Shuffle enabled                                      |
| `player.volume`            | `number`                           | Volume 0–1                                           |
| `player.balance`           | `number`                           | Stereo balance −1…1 (0 = center)                     |
| `player.muted`             | `boolean`                          | Mute state                                           |
| `player.canGoPrevious`     | `boolean`                          | Previous control enabled                             |
| `player.canGoNext`         | `boolean`                          | Next control enabled                                 |
| `queue.length`             | `number`                           | Active playback queue length                         |
| `player.hasTrack`          | `boolean`                          | A track is loaded                                    |
| `skin.alwaysOnTop`         | `boolean`                          | Skin window pinned on top                            |
| `playback.source`          | `"file" | "cd" | null`             | Current playback source                              |
| `visualizer.name`          | `string`                           | Display name of the active global visualizer         |
| `visualizer.canGoPrevious` | `boolean`                          | More than one visualizer installed (wraps)           |
| `visualizer.canGoNext`     | `boolean`                          | Same as `visualizer.canGoPrevious`                   |
| `playlist.sourceLabel`     | `string`                           | Display label for the active playlist view source    |
| `playlist.trackCount`      | `number`                           | Tracks in the active playlist view                   |
| `playlist.hasTracks`       | `boolean`                          | Active playlist view has at least one track          |




### Equalizer bind paths (`eq.*`)

Band indices in bind paths and `eq.setBand` actions are **1-based** (1 = 31 Hz … 10 = 16 kHz). The store uses 0-based indices internally.


| Bind path                  | Type      | Description                    |
| -------------------------- | --------- | ------------------------------ |
| `eq.enabled`               | `boolean` | EQ processing on               |
| `eq.presetId`              | `string`  | Active preset id or `"manual"` |
| `eq.isManual`              | `boolean` | `presetId === "manual"`        |
| `eq.presetLabel`           | `string`  | Display name for active preset |
| `eq.band.1` … `eq.band.10` | `number`  | Band gain in dB (−14…+14)      |




### Panel bind paths (`skin.panel.{panelId}.*`)

Dynamic per-view panel ids from `views.*.panels`. Typical ids: `eq`, `playlist`, `visChooser`.


| Bind path                     | Type      | Description                                                                    |
| ----------------------------- | --------- | ------------------------------------------------------------------------------ |
| `skin.panel.{id}.open`        | `boolean` | Drawer/overlay is open (drives `boundsWhen` slide targets)                     |
| `skin.panel.{id}.closed`      | `boolean` | Negation of `.open`                                                            |
| `skin.panel.{id}.revealed`    | `boolean` | Panel content mounted (before/during slide; hidden after close animation)      |
| `skin.panel.{id}.settled`     | `boolean` | Slide animation complete at the current open/closed target                     |
| `skin.panel.{id}.openSettled` | `boolean` | `.open` and `.settled` (use for close controls that must not appear mid-slide) |




### Skin preference bind paths (`skin.pref.*`)

Per-skin user preferences persisted in `{app_data}/skin-preferences.json`. Spiral built-in keys live under `builtin` in storage; author-defined settings (future) will use `custom` and expose as `skin.pref.{settingId}`.


| Bind path                       | Type      | Description                                                                           |
| ------------------------------- | --------- | ------------------------------------------------------------------------------------- |
| `skin.pref.soundEffectsEnabled` | `boolean` | When `true`, controls with `sound` and programmatic skin sounds play (default `true`) |


**Taxonomy:** `skin.`* = commands and chrome; `skin.pref.*` = per-skin user prefs; distinct from global `eq.*` and ephemeral `view.*` state.

### Skin conditions (`visibleWhen`, `enabledWhen`, `activeWhen`)

Fields that gate visibility or interaction accept either a **leaf bind path** (string) or a boolean composition:


| Form                | Meaning                                     |
| ------------------- | ------------------------------------------- |
| `"player.hasTrack"` | Truthy when the bind evaluates truthy       |
| `{ "all": [ … ] }`  | Every child condition must be truthy        |
| `{ "any": [ … ] }`  | At least one child condition must be truthy |
| `{ "not": … }`      | Negates a child condition                   |


`enabledWhen` — control is interactive when the condition is truthy (omit = always interactive).

`activeWhen` — bitmap/primitive `button` nodes and `buttonGroup` elements only: keep the pressed overlay while truthy (WMP sticky buttons).

All interactive renderers honor `enabledWhen`: bitmap and primitive buttons, button groups, strip/bitmap/vertical/horizontal sliders, and primitive slot controls (transport, seek, volume, queue, visualizer).

Example (Xbox seek/volume — interactive only after intro and while shutter is open):

```json
"enabledWhen": {
  "all": ["view.shutter.open", "view.xIntro.done"]
}
```



## Manifest sound effects

Skins may declare optional short UI sounds under the pack root:

```json
"soundEffects": {
  "button": "sounds/buton",
  "window": "sounds/window",
  "open": "sounds/open",
  "close": "sounds/close"
}
```

Paths are under `assets/` without extension (`.wav` required on disk). Controls reference keys via an optional `sound` field on `button` nodes and `buttonGroup` presentations (group-level sound plays on any element click).

## Tooltips

Interactive controls show **native OS tooltips** via the HTML `title` attribute. Authors can override labels in `skin.json`; otherwise the runtime derives sensible defaults from the control's action and current bind state.

### Manifest fields

Available on **control nodes** (`button`, `seekbar`, `volume`, `time`, etc.) and **button-group elements**:


| Field         | Type                     | Purpose                                                   |
| ------------- | ------------------------ | --------------------------------------------------------- |
| `tooltip`     | `string`                 | Static label, or template with `{bind.path}` placeholders |
| `tooltipWhen` | `Record<string, string>` | Bind path → label when truthy (last match wins)           |


Resolution order: `tooltipWhen` → `tooltip` template → built-in default.

Example — explicit mute toggle without scripting:

```json
{
  "action": "player.toggleMute",
  "tooltip": "Mute",
  "tooltipWhen": { "player.muted": "Unmute" }
}
```

Example — seek position template:

```json
{
  "type": "seekbar",
  "tooltip": "{player.positionLabel} / {player.durationLabel}"
}
```



### Built-in defaults

When `tooltip` / `tooltipWhen` are omitted, the runtime derives labels from `action` and bind state:

- `player.toggleMute` → Mute / Unmute
- `player.togglePlayPause` → Play / Pause
- `player.cycleRepeat` → Repeat: off / all / one
- `skin.toggleView` → Toggle {viewId}
- Window chrome actions → Choose skin, Minimize window, Exit skin mode, etc.

**Sliders** update live while the pointer moves:


| Control | Default tooltip                                    |
| ------- | -------------------------------------------------- |
| Volume  | `Volume: 72%`                                      |
| Balance | `Balance: L12` / `Balance: R8` / `Balance: Center` |
| Seek    | `1:23 / 4:56` (pointer position / duration)        |
| EQ band | `125 Hz: +3.0 dB`                                  |


**Digit time** controls show elapsed or remaining time and hint that clicking toggles the mode.

Button groups swap the tooltip per hovered region (same pattern as classic WMP `upToolTip`).

## Window (`views.*.window`)

Each view declares native window constraints in its own `window` block. Skin mode always uses a **frameless** transparent native window. There is no built-in title bar — authors declare window chrome in the layout and wire `skin.`* / `app.quit` actions (see below). Right-click still opens a native context menu (pin, Studio, return to library) as a fallback.


| Field                            | Purpose                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `clipMask`                       | Reserved: PNG alpha mask for shaped windows (not yet applied at runtime)                         |
| `defaultWidth` / `defaultHeight` | Initial size when no per-skin position is saved (logical px); include chrome drawn in the layout |
| `minWidth` / `minHeight`         | Passed to `setSizeConstraints`                                                                   |
| `maxWidth` / `maxHeight`         | Optional upper bounds; omitted means unbounded on that axis                                      |
| `resizable`                      | When `false`, the window is fixed to the default size                                            |
| `snapEnabled`                    | When `false`, edge snapping is disabled (useful for fixed chrome skins)                          |


Position is remembered **per skin id** in local storage. Sizes are stored in **logical** pixels to behave correctly on Retina displays.

### Layout modes


| Mode              | Audience              | Chrome pattern                                                     |
| ----------------- | --------------------- | ------------------------------------------------------------------ |
| `canvas`          | WMP classic bitmap    | Stage `dragInference: "auto"` (default)                            |
| `slots` (default) | CSS flex + primitives | `header` region with `dragRegion: true` + primitive `button` nodes |




### Window drag inference (`dragInference`)

Canvas views default to `"auto"`: the runtime sets `data-tauri-drag-region="deep"` on `.skin-canvas-layout__stage`. Tauri walks the pointer path upward; clicks drag the window when they reach the stage and nothing along the path is a clickable element (or is marked `data-tauri-drag-region="false"`). This matches classic WMP behavior where non-interactive hits move the frameless window.


| Value      | Behavior                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------ |
| `"auto"`   | Stage-level deep drag (runtime default when `layoutMode` is `canvas`)                      |
| `"manual"` | Explicit behavior via `dragRegion: true` flags (runtime default for `layoutMode: "slots"`) |


Per-view `dragInference` overrides the `layoutMode` default. Omit on canvas views unless overriding — the runtime resolves `"auto"` from `layoutMode`.

Interactive controls opt out with `data-tauri-drag-region="false"` (bitmap buttons, button groups, bitmap sliders). Native `<button>` hit targets (strip sliders, digit time, visualizer expand toggle) are excluded automatically.

For `"manual"` canvas views, use `decoration` + `dragRegion: true` or `dragRegion: true` on a `region` / `row` / `column`. For slots views, mark the header (or other chrome) `region` with `dragRegion: true` — the runtime wraps it with `data-tauri-drag-region="deep"`.

Classic WMP skins often use a composite **button group** (`presentation.kind`: `buttonGroup`) for window chrome (expand / minimize / close). Each element maps a color in `positionMap` to an action:


| Field         | Purpose                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `assets`      | `{ default, hover?, pressed? }` — explicit paths under `assets/` including extension                         |
| `assetsWhen`  | Optional bind path → asset set when truthy (last match wins)                                                 |
| `positionMap` | Color-key PNG for hit testing (e.g. `buttons/window-chrome-map.png`) — **authoritative**; WMP `mappingImage` |
| `elements`    | `{ mappingColor, action }` pairs — hex colors match map pixels                                               |
| `elevateWhen` | Optional list of sibling `buttonGroup` node ids — co-elevate above those groups on hover/press (see below)   |


**Overlapping button groups:** WMP transport chrome often stacks groups whose `bounds` rects overlap but whose `positionMap` regions do not (e.g. a play+stop composite sheet under a pause overlay). The runtime resolves hits from map pixels (not bounding boxes) and dynamically raises the active group's `zIndex` on hover or press. When a sibling overlay must stay painted above part of the active sheet — pause over a play+stop composite while hovering stop — set `elevateWhen` on the overlay group to the composite group's node id. The overlay co-elevates one step higher so its artwork wins in the shared region.

## Layout modes (`views.*`)


| Field                            | Values                                               | Purpose                                                                    |
| -------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `presentation`                   | `primary`, `exclusive`, `auxiliary`                  | How the runtime manages the native window for this view                    |
| `layoutMode`                     | `slots` (default), `canvas`                          | `slots` fills `SkinShell` regions; `canvas` places nodes with `bounds`     |
| `dragInference`                  | `auto` (canvas default), `manual`                    | Stage-level deep drag vs explicit `dragRegion` flags                       |
| `canvas.width` / `canvas.height` | px                                                   | Stage size when `layoutMode` is `canvas`                                   |
| `bounds`                         | `{ x, y, w, h, zIndex? }`                            | Position in the current layout context (stage-absolute at root; parent-relative inside nested groups) |
| `dragRegion`                     | `true` on `region` / `decoration` / `row` / `column` | Window drag handle (slots and manual canvas)                               |
| `hitArea`                        | node type                                            | Solid hit target without Tauri drag (e.g. ear tabs on click-through skins) |


Auxiliary windows bootstrap only the subsystems their layout needs: `eqBand` nodes load the EQ bridge, `visualizer` nodes load the visualizer bridge, `playlist` nodes load the playlist store. Canvas aux views skip theme bootstrap. The layout walk recurses through container nodes including `tiledFrame`.

Root layout for canvas views is typically `{ "type": "canvas", "children": [ … ] }`.

### Coordinate spaces and nested groups

Canvas views use an explicit coordinate context. Shared helpers live in `src/lib/skinLayout.ts` (`walkLayoutTree`, `resolveAbsoluteBounds`, `localizeBounds`, `validateLayoutTree`). Runtime pushes a layout context stack via `SkinLayoutContext` when rendering bounded groups.

| Role | Node type | Child `bounds` |
| --- | --- | --- |
| View stage root (`layoutMode: "canvas"`) | `canvas` | **Stage-absolute** (origin at the stage top-left) |
| Nested bounded group | **`subview`** | **Parent-relative** (origin at the group’s bounds top-left) |
| `tiledFrame` content area | (children of `tiledFrame`) | **Content-inset-relative** |
| `scrollStrip` slide item `y` | (inside `presentation.slides`) | Stage-absolute; runtime subtracts the strip’s **absolute** origin |

Rules:

- Only the view layout root may be `canvas`. Nested clusters use `subview` with required `bounds` (parent-relative). Nested `canvas` fails validation (TS lint + Rust pack load).
- `subview` is never valid as a view layout root.
- Optional `passthrough: true` on `subview` makes the group bounds box ignore pointer events (children still receive them) — WMS passthrough subviews.
- `bounds.x` / `bounds.y` are offsets within the **current** layout context. `bounds.right` resolves against the **current context width**, not always the full stage.
- Container children are paint-sorted by `bounds.zIndex` at every level (`sortChildrenByZIndex`), including nested `subview` / flex / `tiledFrame` children.
- Stretch / `bottom` chrome sizing stays **`tiledFrame` tiles only** (`resolveStretchBounds`). Ordinary `subview` groups use fixed `LayoutBounds` (plus optional `right` against context width).

`validateLayoutTree` runs on pack load (logs structural errors) and via `npm run lint:skins`. Duplicate ids, nested `canvas`, and missing `subview` bounds are errors; missing `id` is a warning.

Canvas skins may ship a pack-level `stylesheet`. Target nodes by `id` (`data-node-id`); use `classPrefix` on primitives only when many nodes share the same look (e.g. spiral-default slot controls).

## Stylesheet (`stylesheet`)

Optional `skin.css` (or any path relative to the pack root). The runtime **auto-scopes** every rule to the active skin by prefixing selectors with `[data-skin-id="{skinId}"]` — authors write plain selectors; do not repeat the skin id in `skin.css`.


| Author writes                          | Runtime applies                                                 |
| -------------------------------------- | --------------------------------------------------------------- |
| `.skin-text { font-size: 11px; }`      | `[data-skin-id="my-skin"] .skin-text { … }`                     |
| `[data-node-id="track-title"] { … }`   | `[data-skin-id="my-skin"] [data-node-id="track-title"] { … }`   |
| `[data-view-id="playlist"] .foo { … }` | `[data-skin-id="my-skin"] [data-view-id="playlist"] .foo { … }` |


Rare unscoped rules (e.g. host chrome) may use `:global(.selector) { … }`. `@keyframes` and `@font-face` are not prefixed.

**Use flat selectors** in `skin.css` (no CSS nesting). The scoping pipeline does not expand nested rules before prefixing.

This sandboxing keeps skin CSS from leaking into the host app and is the foundation for user-authored packs and a future skin editor (preview = same scoping as runtime).

## Text nodes (`type`: `text`)

Text nodes bind dynamic or static labels. **Overflow behavior** lives in JSON; **typography** (font, color, weight, alignment) belongs in the skin stylesheet.


| Field      | Purpose                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `bind`     | Data bind path (e.g. `track.title`)                                                                                            |
| `value`    | Static label when `bind` is omitted                                                                                            |
| `overflow` | Runtime overflow: omit/`visible` (plain text), `clip` (ellipsis), `scroll` (marquee), `scroll-bounce` (pause–scroll–snap-back) |
| `id`       | Unique node id — exposed as `data-node-id` on the text element; primary CSS hook                                               |


CSS targeting examples:

```css
/* skin.css — auto-scoped to the active skin; no [data-skin-id] prefix needed */

/* Skin-wide text defaults */
.skin-text { font-size: 11px; }

/* Unique text node by id */
[data-node-id="track-title"] { font-weight: 600; }

/* Several text nodes, same look — comma-list ids (no one-off classes) */
[data-node-id="eq-balance-label"],
[data-node-id="eq-volume-label"] { color: #77ce07; }

/* Control by id */
[data-node-id="eq-reset"].skin-primitive-btn--text { color: #ddd; }

/* Bounds box by node id (motion, padding around a child control) */
.skin-bounds--motion[data-bounds-for="vis-prev"] {
  transition: top 500ms linear;
}

/* Child inside a bounds box */
.skin-bounds[data-bounds-for="pl-view"] .skin-playlist-view { padding: 2px; }
```

**Which hook to use:**

| Styling                           | Selector                                                     |
| --------------------------------- | ------------------------------------------------------------ |
| One text node                     | `[data-node-id="track-title"]`                               |
| Several text nodes, same look     | Comma-list `[data-node-id="a"], [data-node-id="b"]`          |
| Control with an `id`              | `[data-node-id="pl-list"]`, `[data-node-id="vis-viz"]`       |
| Bounds box (position / motion)    | `.skin-bounds[data-bounds-for="vis-prev"]`                   |
| Child inside a bounds box         | `.skin-bounds[data-bounds-for="pl-view"] .skin-playlist-view` |
| Skin-wide text defaults           | `.skin-text`                                                 |
| Shared slot controls (many nodes) | `classPrefix` on primitives only, e.g. `skin-spiral-default` |

`data-bounds-for` is always on the `.skin-bounds` wrapper when the node has an `id`. `[data-node-id]` stays on the control root (button, text, slider, etc.) so the two hooks never collide.


Theme-following skins use app CSS variables directly (`var(--color-text-primary)`, etc.).

## Scroll strip nodes (`type`: `scrollStrip`)

For **bitmap promo columns** that slide vertically between info-panel pages (XBOX content aux, future Lost Planet-style panels). This is separate from `text` + `overflow: scroll`, which marquees **live strings** (track title, metadata).

| Field | Purpose |
| --- | --- |
| `id` | Stable id for `scrollStrip.*` binds and actions |
| `bounds` | Clipped viewport (`overflow: hidden`) |
| `presentation.kind` | `"bitmapVertical"` |
| `presentation.items` | Bitmap strips (`asset`, `w`, `h`) keyed by `id` |
| `presentation.slides` | Ordered slide layouts: item id → stage-absolute `y` (WMP `subview top`); runtime subtracts the strip’s absolute origin from the layout context stack |
| `presentation.transitionMs` | Vertical move duration (default `500`) |

**Binds:** `scrollStrip.{id}.slide.{n}`, `canPrev`, `canNext`, `atFirst`, `atLast`.

**Actions:** `scrollStrip.prev`, `scrollStrip.next`, `scrollStrip.setSlide` (payload `{ id, slide? }`).

State resets when an aux view closes (same lifecycle as slideshow deck/page).

### Resizable canvas views

When a view's merged `window.resizable` is `true`, the canvas stage tracks the native window size via `ResizeObserver` instead of fixed `canvas.width` / `canvas.height`. Use a `tiledFrame` node for WMP-style stretchable window chrome; inner children use `bounds` relative to the computed **content rect** (origin at top-left of the inset area).

## Tiled frame (`type`: `tiledFrame`)

WMP auxiliary windows (playlist, visualizer, info) use frame tiles that stretch on resize. Wrap view content in a `tiledFrame` container. Two presentation shapes are supported:

### Preset (T3-style 9-slice)


| Field                         | Purpose                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `presentation.kind`           | `"tiledFrame"`                                                                   |
| `presentation.assets`         | Tile file paths under `assets/` including extension (`topLeft`, `topCenter`, …)  |
| `presentation.tileSizes`      | Fixed `{ w, h }` per tile for layout math                                        |
| `presentation.frameThickness` | Top/bottom chrome band height in px (53 for T3 plView)                           |
| `presentation.contentInset`   | `{ left, top, right, bottom }` — inner content area insets from window edges     |
| `children`                    | Controls placed inside the content rect (coordinates relative to content origin) |


Horizontal stretch tile widths follow WMP `checkPlViewSize`: top = `floor(windowW / 2) + 10`, bottom = `floor(windowW / 2)`. Native OS resize handles dragging when `window.resizable` is `true`; `resizeGrip` is decorative.

### Explicit tiles (multi-layer frames)

For skins with stacked WMP subviews (e.g. Xbox dual-layer frames), declare each tile independently:


| Field                       | Purpose                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `presentation.contentInset` | Inner content area insets from window edges                                                                                                                        |
| `presentation.tiles[]`      | Ordered list of frame tiles                                                                                                                                        |
| `tiles[].asset`             | Skin asset path                                                                                                                                                    |
| `tiles[].bounds`            | WMP stretch bounds: fixed `{ x, y, w, h }`, horizontal stretch `{ x, right, y, h }`, vertical stretch `{ x, y, w, bottom }`, bottom-anchored `{ x, bottom, w, h }` |
| `tiles[].repeat`            | `"horizontal"` or `"vertical"` for tiled stretch bands                                                                                                             |
| `tiles[].tileUnit`          | `{ w, h }` source tile size for repeat sizing                                                                                                                      |
| `tiles[].zIndex`            | Paint order; defaults to `0` for repeat tiles, `2` for caps. Content renders at z=1; caps above content are clipped to the content rect.                           |
| `children`                  | Controls inside the content rect                                                                                                                                   |


Stretch bands use `zIndex` below content; corner caps use `zIndex` above content.

## Strip slider (`presentation.kind`: `stripSlider`)

WMP-style filmstrip sliders: one PNG frame per discrete value step. Used by `seekbar`, `volume`, and `eqBand` layout nodes.


| Field                        | Purpose                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `strip`                      | Filmstrip asset under `assets/` (horizontal or vertical stack of frames)                                                                                                                                                                                           |
| `positionMap`                | Optional color-key PNG for non-linear hit testing (WMP `positionImage`)                                                                                                                                                                                            |
| `frameWidth` / `frameHeight` | Single frame size in logical px                                                                                                                                                                                                                                    |
| `frameCount`                 | Number of frames in the strip                                                                                                                                                                                                                                      |
| `direction`                  | Interaction axis for position-map parsing and linear fallback: `horizontal` (left→right) or `vertical` (bottom→top for frame 0). Defaults to `horizontal` for seek, `vertical` for volume/EQ.                                                                      |
| `valueFrames`                | How normalized value 0…1 maps to strip frame indices. `ascending` (default): frame 0 = min value. `descending`: frame 0 = max value. Applies to both display and pointer interaction.                                                                              |
| `mapFrames`                  | How position-map colors map to frame indices along the interaction axis. `ascending` (default): horizontal left / vertical bottom = frame 0. Use `descending` when the WMP filmstrip runs opposite to the map gradient (e.g. Xbox volume: frame 0 art = full bar). |


**Strip layout vs interaction axis:** the runtime infers how frames are stacked in the PNG (`inferStripSliderStripLayout`) for CSS `background-position`. This is independent of `direction`, which only governs pointer hit testing. Example: Xbox volume uses a vertically stacked filmstrip with `direction: "horizontal"` because the user drags left-to-right.

**Position maps:** colors are mapped to frames by normalized position along the interaction axis, not by rank order. Smooth gradient maps (many gray shades for fewer frames) work correctly. Transparent or chroma-key pixels are non-interactive (WMP behavior) — only opaque map pixels accept pointer input. Dial-style circular mini-sliders derive a clockwise path from the filmstrip and ignore `valueFrames`.

## Digit time (`presentation.kind`: `digitStrip`)

Classic WMP skins show elapsed or remaining time as **MM:SS** using a horizontal digit strip (`numbers.bmp` / `time.png`: 12 frames × 14px — digits 0–9, colon, minus). Layout node type `time` with `digitStrip` presentation:


| Field                                     | Purpose                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `strip`                                   | Asset file path under `assets/` including extension (e.g. `time/numbers.png`)         |
| `frameWidth` / `frameHeight`              | One digit/sign window size (typically 14×15)                                          |
| `slots`                                   | `{ role, x }` windows: `sign`, `minuteTens`, `minuteOnes`, `secondTens`, `secondOnes` |
| `signFrameElapsed` / `signFrameRemaining` | Strip frame indices for `:` vs `-` (defaults 10, 11)                                  |


Click toggles elapsed ↔ remaining (matches WMP `SetTimeShowState`). Use `visibleWhen: "player.hasTrack"` to hide when idle.

## Bitmap button GIF playback

Bitmap buttons (`presentation.kind`: `bitmap`) with `.gif` hover or pressed art use canvas playback (not CSS backgrounds) so file NETSCAPE loop metadata is honored. Encode button GIFs with ffmpeg `-loop -1` (no NETSCAPE extension = play once). On idle the runtime draws the last frame of the default asset; entering hover, press, or returning to default replays the animation from frame 0.

## Animated GIF (`presentation.kind`: `gif`)

eleClassic WMP skins use looping GIFs for status chrome (e.g. T3 `m_idle.gif` / `m_playback.gif`). Use a `decoration` node with `gif` presentation:


| Field   | Purpose                                                                 |
| ------- | ----------------------------------------------------------------------- |
| `asset` | Path under `assets/` including extension (e.g. `animations/m_idle.gif`) |


WMP source GIFs use magenta (`#FF00FF`) as a fake transparent color — bake real alpha before bundling (see `chroma_gif` in `scripts/import-skynet-wmp-assets.sh`). Raw magenta GIFs render as solid pink.

Toggle with `visibleWhen` binds such as `player.isPlaying` and `player.notPlaying`.

## Playlist view (`type`: `playlist`)

Reusable compact track list for skin playlist drawers and panels. Sources: **All tracks** (library, title sort), **Up Next** (tracks after the current item in playback order), and each user-defined playlist (sorted by title).

Wire a `playlist` node with `presentation.kind`: `compact`:


| Field          | Purpose                                 |
| -------------- | --------------------------------------- |
| `showDropdown` | Source selector at top (default `true`) |
| `showDuration` | Duration column (default `true`)        |


Set an `id` on the playlist node and target `[data-node-id="…"]` in `skin.css` for per-skin styling.

Dropdown changes invoke `playlist.setSource`; row clicks invoke `playlist.playTrack`. Bind `playlist.sourceLabel`, `playlist.trackCount`, or `playlist.hasTracks` for chrome text and visibility.

## Skin window actions


| Action ID                | Description                                |
| ------------------------ | ------------------------------------------ |
| `skin.openPicker`        | Open Studio (Skins section)                |
| `skin.exit`              | Exit skin mode                             |
| `skin.restoreMainWindow` | Hide skin mode and show the library window |
| `skin.minimize`          | Minimize the skin-mode window              |
| `skin.toggleAlwaysOnTop` | Toggle always-on-top for the skin window   |
| `app.quit`               | Quit Spiral                                |




## Visualizer (`skin.json` → `visualizer`)

Skins declare visualizer reference (optional), shell placement, and sizing separately from the layout `visualizer` control node.


| Field                          | Values                           | Purpose                                                               |
| ------------------------------ | -------------------------------- | --------------------------------------------------------------------- |
| `id`                           | contribution id, `global`, or omit | Pins a visualizer (`authorId.packId.type.contributionId`); `global`/omit follows the picker |
| `placement`                    | `top`, `bottom` (default)        | Where the visualizer band sits in `SkinShell`                         |
| `display`                      | `mini`, `panel` (default `mini`) | `mini` = compact strip; `panel` = fills the visualizer slot           |
| `size.width`                   | `fill` or px                     | Slot width                                                            |
| `size.height`                  | `flex`, `fill`, or px            | `flex` grows to use remaining shell height (typical top panel layout) |
| `size.minHeight` / `maxHeight` | px                               | Optional bounds                                                       |


Pinned visualizer example:

```json
"visualizer": {
  "id": "spiral.core.visualizer.wave",
  "placement": "top",
  "display": "panel",
  "size": { "width": "fill", "height": "flex" }
}
```

Follow global picker (omit `id` or use `"global"`):

```json
"visualizer": {
  "placement": "top",
  "display": "panel",
  "size": { "width": "fill", "height": "flex" }
}
```



## SkinShell slots

Skin layout nodes map to shell slots, not ad-hoc markup:


| Slot         | Typical content              |
| ------------ | ---------------------------- |
| `header`     | Transport or title row       |
| `art`        | Album art                    |
| `info`       | Title / artist / album       |
| `controls`   | Transport + seek             |
| `visualizer` | `VisualizerSlot`             |
| `footer`     | Volume, queue, extra actions |


Unset slots receive the V1 default Spiral layout. Skins override individual slots without rewriting the shell.

## Visualizer cross-window data pipe

The Web Audio `AnalyserNode` is created in the main window on the shared playback bus (`src/lib/playback/audioOutput.ts`, consumed by `VisualizerSlot` / `SceneRenderer`). File playback taps Howler's master gain; CD playback taps the PCM pipeline gain — both route through the same analyser.

When skin mode runs in a **second Tauri webview**, it must not instantiate a second analyser. Plan:

1. `VisualizerDataProvider` (main window): samples `getAnalyser()` each animation frame and publishes frequency/time-domain frames (e.g. Tauri event or shared channel).
2. `VisualizerSlot` **subscriber** (skin-mode webview): receives frames and passes them to a renderer; the main window continues to read the analyser locally via the same slot.

`VisualizerSlot` is the layout integration point — swap the inner renderer per skin without changing transport or seek components.

**V1.5 status:** `VisualizerDataProvider` in `src/lib/visualizerDataBridge.ts` publishes 64-bin frames from the main window; skin mode subscribes via `useVisualizerFrame` and `VisualizerSlot`.

## Shared hooks


| Hook                  | Purpose                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `usePlaybackProgress` | Seek drag state, live RAF position while playing, scrubber value |


Used by `SeekBar`; import this hook in custom skin seek controls to avoid duplicating seek logic.

## View lifecycle effects (`views.*.onActivate`)

Effects declared on a view run **once** when the skin-mode window becomes visible (same trigger as classic WMP `onLoad` + delayed `onTimer`). Scheduled on mount; timers are cancelled on unmount. Re-schedule only when the view definition changes, not on every view-state tick.

```json
"onActivate": [
  {
    "when": "view.introLight.pending",
    "action": "view.setVariable",
    "payload": { "variable": "introLight", "value": "playing" }
  },
  {
    "when": "view.shutter.intro",
    "delayMs": 1000,
    "action": "view.setVariable",
    "payload": { "variable": "shutter", "value": "opening" },
    "sound": "open"
  }
]
```


| Field     | Required | Meaning                                                                     |
| --------- | -------- | --------------------------------------------------------------------------- |
| `when`    | no       | Condition; effect runs only when truthy (same evaluator as `visibleWhen`)   |
| `delayMs` | no       | Wait after activate before dispatch (default `0`)                           |
| `action`  | yes      | Existing skin action id (e.g. `view.setVariable`)                           |
| `payload` | no       | Merged into action payload                                                  |
| `sound`   | no       | Manifest `soundEffects` key played **before** the action (transition start) |


Delayed effects re-evaluate `when` at **fire time** — if state changed during the delay, the effect no-ops. Effect-level `when` (bind path) is distinct from `payload.when` on `view.setVariable` (value equality guard).

## State transition events (`views.*.state.*.on`)

User-driven state changes are declared as ordered transition tables on view-state variables. Buttons dispatch `view.applyStateEvent` with `{ variable, event }`; the runtime evaluates branches in order and applies the first match.

```json
"state": {
  "shutter": {
    "default": "intro",
    "on": {
      "toggle": [
        { "from": ["intro", "closed"], "set": "opening", "sound": "open" },
        { "from": ["open"], "set": "closing", "sound": "close" }
      ]
    }
  }
}
```

```json
{
  "type": "button",
  "action": "view.applyStateEvent",
  "payload": { "variable": "shutter", "event": "toggle" }
}
```


| Field        | Meaning                                            |
| ------------ | -------------------------------------------------- |
| `on.<event>` | Author-defined event name (e.g. `toggle`)          |
| `from`       | Current values that allow this branch (omit = any) |
| `set`        | New value assigned via `setVariable`               |
| `sound`      | Optional manifest key played **before** `set`      |


No matching branch → no-op (e.g. `opening` / `closing` need no extra guards). Presentation nodes (`visibleWhen`, GIF `completeAction`) remain unchanged.

**Incremental path:** [skin-view-effects-plan.md](../../../docs/skin-view-effects-plan.md) — Phase 3 adds full timelines (#17).

## Future: declarative skin animations (post-epic)

Not in V1/V2 scope. Documented so the manifest/renderer do not assume static chrome only.

Classic WMP skins used timed show/hide, frame sequences, and event-driven transitions (e.g. a “door opening” reveal on load or play). Spiral should support the same *feel* via **declarative timelines** — not skin scripting.

**Triggers** (presentation events, separate from the action catalog): e.g. `skin.loaded`, `view.activated`, `player.playbackState` transitions, `track.changed`.

**Targets**: layout nodes with stable `id`s, especially on the **absolute overlay layer** (decorative chrome, masks, non-interactive regions).

**Timeline backends** (pluggable, like `presentation.kind`):


| Kind     | Typical use                                                   |
| -------- | ------------------------------------------------------------- |
| `sprite` | Frame sequence from a sheet + grid descriptor (most WMP-like) |
| `css`    | `@keyframes` driven by bind→`data-*` on trigger               |
| `clip`   | Animated window mask / reveal (door opening)                  |
| `video`  | Short WebM/WebP one-shot or loop in `assets/`                 |


**V2 guardrails** (keep iteration cheap later): absolute/overlay nodes in schema; node `id`s; sprite grid descriptor reserved; bind→attribute channel shared with CSS controls; respect `prefers-reduced-motion`.

See spiral-desktop [#17](https://github.com/brpowell/spiral-desktop/issues/17) for full planning notes.