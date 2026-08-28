# Playback skin contract

Shared playback UI lives under `src/components/playback/` (`PlaybackTransport`, `NowPlayingArt`, `NowPlayingMetadata`, `SeekBar`, `VolumeControl`, `QueueButton`, `VisualizerSlot`). Flow skins compose these via a flex layout tree; canvas skins place them with absolute `bounds`. Import from `src/components/playback` (barrel) or individual subfolders.

V1 components read `usePlayerStore` directly. **V2:** skin mode uses manifests (`skin.json` v1) that bind to the action catalog and data paths below via `SkinLayoutRenderer` — see `src/components/playback/skin/` and [`skin-v1.schema.json`](https://raw.githubusercontent.com/spiral-powered/spk-format/main/schemas/skin-v1.schema.json).

## Authorship modes and ownership

Skins vary along two axes. They correlate — canvas skins attract designer tooling — but neither determines the other. Headspace, T3, and Xbox are all canvas skins authored entirely by hand and by the WMS importer.


| Axis                                   | Values                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Layout mode** (property of the layout root) | `column`/`row` = size/position from a flex tree; `canvas` = absolute `bounds` |
| **Authorship path** (property of the author) | Code-first: hand-edited `skin.json` + `skin.css`. Designer-first: property panels writing `skin.json` |


Code-first authors use `skin.json` for structure and behavior and put styling in `skin.css`. Designer-first authors get one write target: the property panel writes to the node.

### Ownership


| Concern                                                                                     | Owner                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Position, size, z-order, and state-driven changes to them (`bounds`, `boundsWhen`, `zIndex`, `transition`) | `skin.json` — the runtime **computes** with these: nested coordinate spaces, native window sizing, paint order, WMS import diffing, lint |
| Tagged renderer config (`presentation.*`: `kind`, assets, icon, strip, …)                     | `skin.json`                                                                                                                              |
| Panel-writable paint (`style.*`)                                                             | `skin.json` — write target for a property panel                                                                                          |
| Cascade-dependent styling, pseudo-states, shared looks across many nodes                     | `skin.css`                                                                                                                               |


Style fields on `style` are **optional wherever they exist**. Omitting one cedes that property to CSS. `presentation` stays tagged drawing-backend config and is omitted on `text`, `playlist`, and `subview`. There is no separate schema or manifest flag for designer-authored skins — the difference is which fields get populated.

### Precedence

JSON-declared geometry and style emit as **inline styles** (see `SkinBounds.tsx` for `bounds`; node `style` is applied on the control root that carries `data-node-id`). CSS must use `!important` to override them. That is deliberate: needing `!important` is the signal that you have left the property panel's model, and a designer will not round-trip that value.

### Non-goals

- **Do not add flex properties to `skin.json`.** `overlay` / `row` / `column` have no `gap` / `align` / `justify` / `padding` / `direction`, and should stay that way. Flow layout is CSS.
- **Do not add drag-based editing to flow.** In flow the engine owns geometry — there is no `x` to write back. Direct manipulation of derived layout means guessing author intent on every gesture.
- **Do not optimize canvas `skin.json` for machine authorship.** Reformatting, flattening `subview` groups, or stripping readable structure would break the hand-authoring path that produced every pack shipped today.
- **Do not let a property panel write CSS.** Attributing a computed value back to a source declaration is cascade provenance — the reason devtools style editing is a scratchpad, not a source editor.
- **Do not use `framer-motion` in the skin engine.** Skin motion is CSS and (later) a host interpolator over the scene tree. App chrome may keep the library independently.

### Canvas bounds box

In canvas mode the runtime sizes `.skin-bounds` from `bounds` and the control **fills that box**. Unbounded children of a canvas `overlay` fill the overlay. Pack CSS should not set `width` / `height: 100%` or `:has(> …)` stretch on `.skin-bounds` to achieve this.

## Action catalog

Named actions invoked by shared playback components. Skin authors wire controls to these identifiers.


| Action ID                 | Description                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `player.togglePlayPause`  | Toggle play/pause. With an empty set list, starts the current playlist source (or all tracks)                                |
| `player.play`             | Start or resume playback. With an empty set list, starts the current playlist source (or all tracks)                         |
| `player.pause`            | Pause playback when playing                                                                                                  |
| `player.stop`             | Stop playback and clear the set list (same as the set list modal Clear action)                                               |
| `player.previousTrack`    | Go to previous track                                                                                                         |
| `player.nextTrack`        | Go to next track                                                                                                             |
| `player.cycleRepeat`      | Cycle repeat mode: off → all → one                                                                                           |
| `player.toggleRepeat`     | Toggle playlist repeat on/off (no repeat-one)                                                                                |
| `player.toggleShuffle`    | Toggle shuffle                                                                                                               |
| `player.seek`             | Seek to ratio 0–1 (payload: `{ ratio: number }`)                                                                             |
| `player.setVolume`        | Set volume 0–1 (payload: `{ volume: number }`)                                                                               |
| `player.setBalance`       | Set stereo balance −1…1 (payload: `{ balance: number }`; 0 = center)                                                         |
| `player.toggleMute`       | Toggle mute                                                                                                                  |
| `navigation.openAlbum`    | Open album view for current track (payload: `{ albumKey: string }`)                                                          |
| `skin.openPicker`         | Open Studio (Skins section)                                                                                                  |
| `skin.exit`               | Exit skin mode                                                                                                               |
| `skin.restoreMainWindow`  | Hide skin mode and show the library window                                                                                   |
| `skin.minimize`           | Minimize the skin-mode window                                                                                                |
| `skin.toggleAlwaysOnTop`  | Toggle always-on-top for the skin window                                                                                     |
| `skin.switchView`         | Switch the primary skin window to an exclusive view (payload: `{ viewId: string }`)                                          |
| `skin.openView`           | Open an auxiliary view window (payload: `{ viewId: string }`)                                                                |
| `skin.closeView`          | Close an auxiliary view window (payload: `{ viewId?: string }`; defaults to the current aux window)                          |
| `skin.toggleView`         | Toggle an auxiliary view window open/closed (payload: `{ viewId: string }`)                                                  |
| `skin.toggleSoundEffects` | Toggle skin sound effects for the active skin (no-op when manifest has no `soundEffects`)                                    |
| `visualizer.previous`     | Cycle to the previous global visualizer                                                                                      |
| `visualizer.next`         | Cycle to the next global visualizer                                                                                          |
| `playlist.setSource`      | Select playlist view source (payload: `{ sourceId: string }` — `all`, `upNext`, or `playlist:{id}`)                          |
| `playlist.playTrack`      | Play a track from the active playlist view (payload: `{ trackId: number }`)                                                  |
| `eq.setBand`              | Set EQ band gain (payload: `{ band: number; gain: number }` — **band is 1-based**, gain in dB −14…+14; enables EQ and forces manual preset) |
| `eq.applyPreset`          | Apply a named preset (payload: `{ presetId: string }`)                                                                       |
| `eq.reset`                | Flatten all bands to 0 dB and set preset to manual                                                                           |
| `eq.setEnabled`           | Toggle EQ processing (payload: `{ enabled: boolean }`; band values preserved when disabled)                                  |
| `eq.previousPreset`       | Cycle to the previous EQ preset (built-ins, then custom)                                                                     |
| `eq.nextPreset`           | Cycle to the next EQ preset                                                                                                  |
| `app.quit`                | Quit Spiral (saves session and closes the app)                                                                               |
| `app.openUrl`             | Open an external URL in the system browser (payload: `{ url: string }`)                                                      |
| `app.openFile`            | Open the library import picker and import selected audio files or folders                                                    |




`eqBand` nodes may set `spread: "linear"`. Those sliders are endpoints of a linear tilt across the 10-band EQ (WMP Plus! Nature bass/treble). Dragging one writes all ten bands as a straight line between the spread control points and forces the manual preset. Independent `eqBand` sliders omit `spread`.




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

All interactive renderers honor `enabledWhen`: bitmap and primitive buttons, button groups, strip/bitmap/vertical/horizontal sliders, and primitive slot controls (transport, seek, volume, visualizer).

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

Paths are under `assets/` without extension (`.wav` required on disk). Controls reference keys via an optional `sound` field on `button` nodes and `buttonGroup` presentations (group-level sound plays on any element click). Use `soundWhen` (same last-match-wins bind map as `tooltipWhen`) when the click sound depends on current state:

```json
{
  "id": "shutter",
  "onClick": [
    { "action": "view.applyStateEvent", "payload": { "variable": "shutter", "event": "toggle" } }
  ],
  "soundWhen": {
    "view.shutter.intro": "open",
    "view.shutter.closed": "open",
    "view.shutter.open": "close"
  }
}
```

Omit a fallback `sound` when unmatched states (e.g. `opening` / `closing`) should stay silent. Lifecycle effects may still set `sound` on `onActivate` for cues that are not a control click.

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
  "onClick": [{ "action": "player.toggleMute" }],
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
| `clipMask`                       | Reserved: PNG alpha mask for native shaped windows. Click-through uses decoration alpha + control bounds instead (see below) |
| `defaultWidth` / `defaultHeight` | Initial size when no per-skin position is saved (logical px); include chrome drawn in the layout |
| `minWidth` / `minHeight`         | Passed to `setSizeConstraints`                                                                   |
| `maxWidth` / `maxHeight`         | Optional upper bounds; omitted means unbounded on that axis                                      |
| `resizable`                      | When `false`, the window is fixed to the default size                                            |
| `snapEnabled`                    | When `false`, edge snapping is disabled (useful for fixed chrome skins)                          |


Position is remembered **per skin id** in local storage. Sizes are stored in **logical** pixels to behave correctly on Retina displays.

### Layout modes


| Mode     | Audience           | Chrome pattern                                                         |
| -------- | ------------------ | ---------------------------------------------------------------------- |
| `canvas` | WMP classic bitmap | Stage `dragInference: "auto"` (default)                                |
| `row` / `column` | CSS flex + primitives | Flex tree (`column` / `row` / …); `dragRegion: true` on chrome row/column |


Audience is a tendency, not a constraint — see [Authorship modes and ownership](#authorship-modes-and-ownership).

### Window drag inference (`dragInference`)

Canvas views default to `"auto"`: the runtime sets `data-skin-drag-region="deep"` on `.skin-canvas-layout__stage`. The runtime walks the pointer path upward; clicks drag the window when they reach the stage and nothing along the path is a clickable element (or is marked `data-skin-drag-region="false"`). This matches classic WMP behavior where non-interactive hits move the frameless window.


| Value      | Behavior                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------- |
| `"auto"`   | Stage-level deep drag (runtime default when `layout.type` is `canvas`)                     |
| `"manual"` | Explicit behavior via `dragRegion: true` flags (runtime default for `row`/`column` roots) |


Per-view `dragInference` overrides the layout-root default. Omit on canvas views unless overriding — the runtime resolves `"auto"` from `layout.type === "canvas"`.

Interactive controls opt out with `data-skin-drag-region="false"` (bitmap buttons, button groups, bitmap sliders, playlist views). Native `<button>` hit targets (strip sliders, digit time, playlist rows, and the library Now Playing visualizer expand toggle) are excluded automatically. Scrollbars sit on a `div`, not a button — without the playlist opt-out, dragging the thumb starts a window drag on canvas skins.

For `"manual"` canvas views, use `decoration` + `dragRegion: true` or `dragRegion: true` on a `row` / `column`. For flow views, mark the chrome row (or other handle) with `dragRegion: true` — the runtime sets `data-skin-drag-region="deep"`.

Classic WMP skins often use a composite **button group** (`presentation.kind`: `buttonGroup`) for window chrome (expand / minimize / close). Each element maps a color in `positionMap` to click effects:


| Field         | Purpose                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `assets`      | `{ default, hover?, pressed?, disabled? }` — explicit paths under `assets/` including extension. `disabled` is composited per button-group element whose `enabledWhen` is false; bitmap buttons use it instead of opacity when present |
| `assetsWhen`  | Optional bind path → asset set when truthy (last match wins)                                                 |
| `positionMap` | Color-key PNG for hit testing (e.g. `buttons/window-chrome-map.png`) — **authoritative**; WMP `mappingImage` |
| `elements`    | `{ mappingColor, onClick? }` pairs — hex colors match map pixels. `onClick` may be omitted for unmapped WMS hits |
| `elevateWhen` | Optional list of sibling `buttonGroup` node ids — co-elevate above those groups on hover/press (see below)   |


**Overlapping button groups:** WMP transport chrome often stacks groups whose `bounds` rects overlap but whose `positionMap` regions do not (e.g. a play+stop composite sheet under a pause overlay). The runtime hit-tests from map pixels (not the group `bounds` box) and uses each mapping color’s AABB as the pointer target so unmapped pixels (magenta / white) pass through to controls underneath — e.g. Nature’s seek thumb under the play-controls sheet. The active group’s `zIndex` rises on hover or press. When a sibling overlay must stay painted above part of the active sheet — pause over a play+stop composite while hovering stop — set `elevateWhen` on the overlay group to the composite group's node id. The overlay co-elevates one step higher so its artwork wins in the shared region.

### Transparent click-through

The skin-mode window is a transparent rectangle. Clicks on empty stage **and on transparent pixels inside irregular artwork** pass through to the desktop (or whatever window is behind) via `setIgnoreCursorEvents`. Hit testing:

| Bounds kind (`data-skin-window-hit`) | Interactive when |
| --- | --- |
| `artwork` (decorations) | The bitmap/gif pixel under the cursor is opaque (alpha ≥ 16). Primitive decorations count as the whole box. |
| `group` (`subview`) | Only if the group paints a CSS background (e.g. Headspace EQ fill). Empty grouping boxes are ignored. |
| `control` (buttons, sliders, visualizers, playlists, button groups, tiled-frame chrome **and content**, …) | The box contains the cursor. Playlist / vis nodes inside a tiled frame often omit `bounds`; the content hole still counts. |

Open drawers stay click-through once their motion settles (`open` / `closed`). The window is forced interactive while a view-state variable is `opening` or `closing`. Unloaded artwork is treated as opaque so holes are not punched during decode. On macOS the runtime deactivates the app while the cursor is over a hole so the hardware click goes through on the first press (a focused key window would otherwise still receive it).

## Layout modes (`views.*`)


| Field                            | Values                                               | Purpose                                                                    |
| -------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `presentation`                   | `primary`, `exclusive`, `auxiliary`                  | Window role. Omit on a single-view skin (assumed primary). Two or more views must mark exactly one as `primary`. |
| `layout.type`                    | `canvas`, `row`, `column`                            | View root only. `canvas` = absolute `bounds`; `row`/`column` = flex tree   |
| `layout.width` / `layout.height` | px (canvas root only)                                | Logical stage size. Native window chrome stays on `window`                 |
| `dragInference`                  | `auto` (canvas default), `manual`                    | Stage-level deep drag vs explicit `dragRegion` flags                       |
| `bounds`                         | `{ x?, right?, y?, bottom?, w?, h?, zIndex? }` | Position in the current layout context. Fixed: `x`\|`right` + `y`\|`bottom` + sizes. Stretch: omit `w` when `x`+`right`, omit `h` when `y`+`bottom`. |
| `dragRegion`                     | `true` on `decoration` / `row` / `column` / …        | Window drag handle (flow and manual canvas)                                |
| `id`                             | string                                               | Stable node id → `data-node-id` (primary CSS hook)                         |
| `className`                      | string                                               | Optional CSS class on the node root (shared look across several nodes)     |
| `style`                          | `nodeStyle`                                          | Optional panel-writable paint (`color`, `fontSize`, …). Omit a field to cede it to CSS |


Auxiliary windows bootstrap only the subsystems their layout needs: `eqBand` nodes load the EQ bridge, `visualizer` nodes load the visualizer bridge, `playlist` nodes load the playlist store. Canvas aux views skip theme bootstrap. The layout walk recurses through container nodes including `tiledFrame`.

Root layout is `canvas | row | column`. Canvas views: `{ "type": "canvas", "width": 760, "height": 394, "children": [ … ] }`. `overlay`, `tiledFrame`, and `subview` are children only.

### Coordinate spaces and nested groups

Canvas views use an explicit coordinate context. Shared helpers live in `src/lib/skinLayout.ts` (`walkLayoutTree`, `resolveAbsoluteBounds`, `localizeBounds`, `validateLayoutTree`). Runtime pushes a layout context stack via `SkinLayoutContext` when rendering bounded groups.

| Role | Node type | Child `bounds` |
| --- | --- | --- |
| View stage root (`layout.type: "canvas"`) | `canvas` | **Stage-absolute** (origin at the stage top-left) |
| Nested bounded group | **`subview`** | **Parent-relative** (origin at the group’s bounds top-left) |
| `tiledFrame` content area | (children of `tiledFrame`) | **Content-inset-relative** |
| `scrollStrip` slide item `y` | (inside `presentation.slides`) | Stage-absolute; runtime subtracts the strip’s **absolute** origin |

Rules:

- Only the view layout root may be `canvas` (`row`/`column` for flow). Nested clusters use `subview` with required `bounds` (parent-relative). Nested `canvas` is schema-invalid.
- `subview` is never valid as a view layout root.
- Grouping `subview` bounds boxes ignore pointer events (children still receive them). Overlapping chrome — e.g. Nature’s leaf over the drawer close control — cannot steal clicks from controls underneath. Optional `passthrough: true` additionally leaves overflow visible for alpha-fringed frames (WMS passthrough).
- `bounds.x` / `bounds.y` are offsets within the **current** layout context. `bounds.right` / `bounds.bottom` are CSS edge insets (distance from the node's far edge to the context edge). Pin or stretch by omitting the near-edge or size: `x`+`right` (no `w`), `right`+`w` (no `x`), and the same for `y`/`bottom`/`h`.
- Container children are paint-sorted by `bounds.zIndex` at every level (`sortChildrenByZIndex`), including nested `subview` / flex / `tiledFrame` children.
- Stretch / edge-pin sizing for **`tiledFrame` tiles** uses the same `layoutBounds` rules (`resolveLocalBounds`). Ordinary nodes may use the same form (e.g. a title bar with `bottom: 0`).

`validateLayoutTree` runs on pack load (logs structural errors) and via `npm run lint:skins`. Duplicate ids and missing `subview` bounds are errors; missing `id` is a warning.

Skins may ship a pack-level `stylesheet`. Target nodes by `id` (`data-node-id`) or shared `className`. Stylesheets are auto-scoped to `[data-skin-id]`.

## Stylesheet (`stylesheet`)

Optional `skin.css` (or any path relative to the pack root). Designer-first skins keep this file for leftovers a panel cannot round-trip (shadow, motion, `:hover`); omit `stylesheet` when it would be empty (Headspace). Code-first skins still own type, flex, and theme tokens here.

The runtime **auto-scopes** every rule to the active skin by prefixing selectors with `[data-skin-id="{skinId}"]` — authors write plain selectors; do not repeat the skin id in `skin.css`.


| Author writes                          | Runtime applies                                                 |
| -------------------------------------- | --------------------------------------------------------------- |
| `.skin-text { font-size: 11px; }`      | `[data-skin-id="my-skin"] .skin-text { … }`                     |
| `[data-node-id="track-title"] { … }`   | `[data-skin-id="my-skin"] [data-node-id="track-title"] { … }`   |
| `[data-view-id="playlist"] .foo { … }` | `[data-skin-id="my-skin"] [data-view-id="playlist"] .foo { … }` |
| `[data-view-playlist="open"] .foo { }` | `[data-skin-id="my-skin"] [data-view-playlist="open"] .foo { }` |


Rare unscoped rules (e.g. host chrome) may use `:global(.selector) { … }`. `@keyframes` and `@font-face` are not prefixed.

View-state variables are exposed as `data-view-{name}` on the **flow inner wrapper** (a descendant of `[data-skin-id]`), so auto-scoped selectors like `[data-view-playlist="open"] [data-node-id="…"]` match. Do not put those attributes on the same node as `data-skin-id`.

**Use flat selectors** in `skin.css` (no CSS nesting). The scoping pipeline does not expand nested rules before prefixing.

This sandboxing keeps skin CSS from leaking into the host app and is the foundation for user-authored packs and a future skin editor (preview = same scoping as runtime).

## Text nodes (`type`: `text`)

Text nodes bind dynamic or static labels. **Overflow behavior** lives in JSON. **Typography** (font size, color, weight, alignment) lives on optional node `style` — the property-panel write target. Omit a `style` field to cede that property to CSS. Do **not** put `presentation` on text; there is no drawing backend to pick (no `kind: "text"`).


| Field      | Purpose                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `bind`     | Data bind path (e.g. `track.title`)                                                                                            |
| `value`    | Static label when `bind` is omitted                                                                                            |
| `overflow` | Runtime overflow: omit/`visible` (plain text), `clip` (ellipsis), `scroll` (marquee), `scroll-bounce` (pause–scroll–snap-back) |
| `style`    | Closed paint bag: `color`, `fontSize` (px), `fontWeight`, `textAlign`, `backgroundColor`                                        |
| `id`       | Unique node id — exposed as `data-node-id` on the text element; primary CSS hook                                               |


Designer-first example. `overflow` stays a type-only flag; paint is `style`. No `presentation`:

```json
{
  "type": "text",
  "id": "eq-preset-label",
  "bind": "eq.presetLabel",
  "style": {
    "color": "#469fe5",
    "fontSize": 8,
    "fontWeight": "bold",
    "textAlign": "center"
  }
}
```

Code-first skins may omit `style` and keep type in `skin.css`. CSS leftovers a panel cannot round-trip stay in CSS for both paths:

```css
/* skin.css — auto-scoped to the active skin; no [data-skin-id] prefix needed */

/* Glow — no round-trippable panel control */
[data-node-id="vis-effect-title"] { text-shadow: 0 0 6px black; }

/* Pseudo-state — not a rest-state style bag */
.viz-btn:hover:not(:disabled) {
  color: var(--color-text-primary);
}

/* Child inside a bounds box (padding / flex stay CSS) */
.skin-bounds[data-bounds-for="pl-view"] .skin-playlist-view { padding: 2px; }
```

**Which hook to use** (code-first CSS; designer-first paint still belongs on `style`):

| Styling                           | Selector                                                     |
| --------------------------------- | ------------------------------------------------------------ |
| One node                          | `[data-node-id="track-title"]`                               |
| Several nodes, same look          | Shared `className`, or comma-list `[data-node-id="a"], …`    |
| Control with an `id`              | `[data-node-id="pl-list"]`, `[data-node-id="seekbar"]`       |
| Group box (padding / flex)        | `[data-node-id="contents"]`                                  |
| Bounds box (position / motion)    | `.skin-bounds[data-bounds-for="vis-prev"]`                   |
| Child inside a bounds box         | `.skin-bounds[data-bounds-for="pl-view"] .skin-playlist-view` |
| Skin-wide text defaults           | `.skin-text`                                                 |

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

When a view's merged `window.resizable` is `true`, the canvas stage tracks the native window size via `ResizeObserver` instead of fixed `layout.width` / `layout.height` on the canvas root. Use a `tiledFrame` node for WMP-style stretchable window chrome; inner children use `bounds` relative to the computed **content rect** (origin at top-left of the inset area).

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
| `tiles[].bounds`            | Same `layoutBounds` as nodes: fixed `{ x, y, w, h }`, stretch `{ x, right, y, h }` / `{ x, y, w, bottom }`, edge-pinned `{ right, y, w, h }` / `{ x, bottom, w, h }` |
| `tiles[].repeat`            | `"horizontal"` or `"vertical"` for tiled stretch bands                                                                                                             |
| `tiles[].tileUnit`          | `{ w, h }` source tile size for repeat sizing                                                                                                                      |
| `tiles[].zIndex`            | Paint order; defaults to `0` for repeat tiles, `2` for caps. Content renders at z=1; caps above content are clipped to the content rect.                           |
| `children`                  | Controls inside the content rect                                                                                                                                   |


Stretch bands use `zIndex` below content; corner caps use `zIndex` above content.

## Bitmap sliders (`bitmapVerticalSlider` / `bitmapHorizontalSlider`)

Tiled track + movable thumb. Used by `eqBand`, `balance`, `volume`, and `seekbar` nodes.

| Presentation | Typical nodes |
| --- | --- |
| `bitmapVerticalSlider` | `eqBand`; vertical `volume` (e.g. Plus! Nature ladybug thumb) |
| `bitmapHorizontalSlider` | `balance`; horizontal `volume` / `eqBand`; thumb-only or track+fill `seekbar` (Nature, Headspace) |

`track` is optional on both kinds. Omit it when the groove is already painted in the panel background (Nature volume/seek, T3 EQ balance, Xbox EQ). `fill` is an optional value clip along the slider axis (WMP `foregroundImage`): left-to-right on horizontal, bottom-to-top on vertical. T3 EQ bands are fill-only. Headspace seek sets both `track` (empty groove) and `fill`. `trackTileWidth` / `trackTileHeight` are required only when `track` is set. `trackWidth` / `trackHeight` define the control box. The WMS importer snaps the **cross axis** of a thumb-only slider down to the thumb when WMS is 1px larger (Nature seek `height` 17 vs 16px thumb; volume `width` 25 vs 24px thumb) so the thumb does not center on a half-pixel and clip. Layout `bounds` keep the WMS size.

**`borderSize` (WMP):** insets the thumb **center** from each end (not the thumb’s top/left edge). Typical skins use ≥ half the thumb size on the travel axis so the full thumb stays visible at 0%/100%. Fill clips to that same center. `thumb` is a state set (`default` required; optional `hover` / `pressed` map WMP `thumbHoverImage` / `thumbDownImage`). Hover art applies only while the pointer is over the thumb sprite.

`volume` + `bitmapVerticalSlider` renders via the shared bitmap vertical slider (same path as `eqBand`). `seekbar` / `eqBand` + `bitmapHorizontalSlider` uses the shared horizontal slider (same path as `balance` / horizontal `volume`).

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

## Primitive button (`presentation.kind`: `primitive`)

App-chrome `button` nodes use the design-system `Button`. Optional presentation fields (ignored on non-button primitive nodes):

| Field     | Purpose |
| --------- | ------- |
| `icon`    | Spiral icon library id **or** pack-relative raster under `assets/` |
| `text`    | Visible label (author content). Distinct from `tooltip` / `aria-label`. |
| `variant` | App Button variant: `primary` \| `secondary` \| `ghost` \| `danger`, or `plain` for a chrome-less hit target (no padding pill, no hover fill). Default `ghost`. |

**Library icon ids:** take the `Icon*` export name from `src/components/icons.tsx`, strip the `Icon` prefix, and lowercase the first letter. Match camelCase exactly (`setList` → `IconSetList`, not `setlist` or `set-list`). Unknown ids render no icon. Asset paths must end in `.png` / `.gif` / `.webp` / `.jpe?g`.

```json
{
  "type": "button",
  "onClick": [
    { "action": "view.applyStateEvent", "payload": { "variable": "playlist", "event": "toggle" } }
  ],
  "tooltip": "Playlist",
  "presentation": {
    "kind": "primitive",
    "icon": "setList"
  }
}
```

If both `icon` and `text` are omitted, the resolved tooltip is shown as the button label. Paint sits beside `presentation` on `style`. Headspace EQ reset is `text` + `variant: "plain"` — a chrome-less hit target, not a ghost `Button`:

```json
{
  "type": "button",
  "onClick": [{ "action": "eq.reset" }],
  "presentation": {
    "kind": "primitive",
    "text": "reset",
    "variant": "plain"
  },
  "style": { "color": "#ddd", "fontSize": 9 }
}
```

## Bitmap button GIF playback

Bitmap buttons (`presentation.kind`: `bitmap`) with `.gif` hover or pressed art use canvas playback (not CSS backgrounds) so file NETSCAPE loop metadata is honored. Encode button GIFs without a NETSCAPE loop extension (play once) — `wms-import` / `skin_convert` do this by default. On idle the runtime draws the last frame of the default asset; entering hover, press, or returning to default replays the animation from frame 0.

## Animated GIF (`presentation.kind`: `gif`)

Classic WMP skins use looping GIFs for status chrome (e.g. T3 `m_idle.gif` / `m_playback.gif`). Use a `decoration` node with `gif` presentation:


| Field        | Purpose                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `asset`      | Path under `assets/` including extension (e.g. `animations/m_idle.gif`) |
| `onComplete` | Optional lifecycle effects after the first scaled loop (`durationMs`)    |


WMP source GIFs use magenta (`#FF00FF`) as a fake transparent color — bake real alpha before bundling via `wms-import` / `skin_convert` (or `--chroma` when the key differs). Raw magenta GIFs render as solid pink.

Toggle with `visibleWhen` binds such as `player.isPlaying` and `player.notPlaying`.

## Playlist view (`type`: `playlist`)

Reusable track list for skin playlist drawers, panels, and in-view overlays. Sources: **All tracks** (library, title sort), **Up Next** (tracks after the current item in playback order), and each user-defined playlist (sorted by title).

Wire a `playlist` node. Feature flags live on the node — there is no `presentation` and no `kind`:


| Field             | Purpose                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `showDropdown`    | Source selector at top (default `true`)                                                          |
| `showDuration`    | Duration column (default `true`)                                                                 |
| `showArtwork`     | Album artwork on each track row (default `false`)                                                |
| `defaultSource`   | Initial source: `all` (default) or `upNext`. Applied on mount; later `playlist.setSource` wins. |
| `style`           | Panel-writable list paint (`color`, `fontSize`, `backgroundColor`, …).                           |
| `sourceStyle`     | Same closed bag on the source dropdown (`__source`).                                             |
| `sourceHoverStyle`| Same closed bag while the source dropdown is hovered (merged on top of `sourceStyle`).           |
| `rowHoverStyle`   | Same closed bag while a track row is hovered (merged under `currentRowStyle` / `playingRowStyle`). |
| `playingRowStyle` | Same closed bag, applied as inline style on the playing row (`__row--playing`).                  |
| `currentRowStyle` | Same closed bag, applied as inline style on the current row (`__row--current`). When the row is also playing, `playingRowStyle` is merged on top. |


Designer-first example. Feature flags and paint live on the node — no `presentation`:

```json
{
  "type": "playlist",
  "id": "pl-list",
  "showArtwork": true,
  "showDuration": true,
  "showDropdown": true,
  "style": {
    "backgroundColor": "#000000",
    "color": "#7ec509",
    "fontSize": 11
  },
  "sourceStyle": {
    "backgroundColor": "#0a1200"
  },
  "sourceHoverStyle": {
    "backgroundColor": "#142000"
  },
  "rowHoverStyle": {
    "backgroundColor": "rgba(204, 255, 0, 0.12)"
  },
  "playingRowStyle": {
    "color": "#ffffff",
    "backgroundColor": "#369108"
  }
}
```

Set an `id` on the playlist node and target `[data-node-id="…"]` in `skin.css` for cascade leftover (code-first skins). Designer-first paint lives on `style` / `sourceStyle` / `sourceHoverStyle` / `rowHoverStyle` / `playingRowStyle` / `currentRowStyle`.

Dropdown changes invoke `playlist.setSource`; row clicks invoke `playlist.playTrack`. Bind `playlist.sourceLabel`, `playlist.trackCount`, or `playlist.hasTracks` for chrome text and visibility.

To overlay the list on a visualizer (Vanilla), keep the playlist node mounted and fade with view-state attributes on the flow inner wrapper (`data-view-{variable}`). Do not use `visibleWhen` if you need a fade-out — that unmounts immediately. Example: `view.applyStateEvent` toggles `playlist` `open`/`closed`, then `[data-view-playlist="open"] [data-node-id="playlist-overlay"]` drives opacity.

## Artwork (`type`: `artwork`)

Current-track cover. Uses the shared `NowPlayingArt` host. In addition to the usual control fields (`style`, `presentation`, …):

| Field | Purpose |
| --- | --- |
| `style` | Panel-writable paint on the art root (e.g. `backgroundColor` for letterbox / empty state). |
| `objectFit` | CSS `object-fit` for the cover image: `cover` (default), `contain`, or `fill`. |

```json
{
  "type": "artwork",
  "id": "btnAlbumArt",
  "objectFit": "contain",
  "style": { "backgroundColor": "#000000" },
  "presentation": { "kind": "css" }
}
```

Cascade leftovers (border-radius, etc.) stay in `skin.css`.

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

Optional pin only. Skins always render the full panel surface in the layout `visualizer` node — size with CSS (`[data-node-id="…"]`) or canvas bounds. The library Now Playing bar owns the mini strip + expand toggle; that is not a skin option.

| Field | Values | Purpose |
| --- | --- | --- |
| `id` | contribution id, `global`, or omit | Pins a visualizer (`authorId.packId.type.contributionId`); `global`/omit follows the picker |

Pinned visualizer example:

```json
"visualizer": {
  "id": "spiral.core.visualizer.wave"
}
```

Follow global picker: omit the top-level `visualizer` object, or use `"id": "global"`.


## Flow layout trees

Flow skins (`layout.type` is `row` or `column`) render the layout JSON as a real flex tree (`column` / `row` / `overlay` + controls). Style with node `style`, `id` → `[data-node-id]`, or optional `className`. There is no shell/slot remapping — the tree is the layout.

## Visualizer cross-window data pipe

The Web Audio `AnalyserNode` is created in the main window on the shared playback bus (`src/lib/playback/audioOutput.ts`, consumed by `VisualizerSlot` / `SceneRenderer`). Library file and CD PCM pipelines route through per-deck gains into the same analyser.

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
| `delayMs` | no       | Wait before dispatch (default `0`)                                          |
| `action`  | yes      | Existing skin action id (e.g. `view.setVariable`)                           |
| `payload` | no       | Merged into action payload                                                  |
| `sound`   | no       | Manifest `soundEffects` key played **before** the action                    |


Immediate effects skip a false `when` at schedule. Delayed effects always start the timer and re-check `when` at fire time, using live view state (not the click snapshot). Effect-level `when` is distinct from `payload.when` on `view.setVariable`.

## State transition events (`views.*.state.*.on`)

User-driven state changes are declared as ordered transition tables on view-state variables. Buttons dispatch `view.applyStateEvent` with `{ variable, event }`; the runtime evaluates branches in order and applies the first match.

```json
"state": {
  "shutter": {
    "default": "intro",
    "on": {
      "toggle": [
        { "from": ["intro", "closed"], "set": "opening" },
        { "from": ["open"], "set": "closing" }
      ]
    }
  }
}
```

```json
{
  "type": "button",
  "onClick": [
    { "action": "view.applyStateEvent", "payload": { "variable": "shutter", "event": "toggle" } }
  ],
  "soundWhen": {
    "view.shutter.intro": "open",
    "view.shutter.closed": "open",
    "view.shutter.open": "close"
  }
}
```


| Field        | Meaning                                            |
| ------------ | -------------------------------------------------- |
| `on.<event>` | Author-defined event name (e.g. `toggle`)          |
| `from`       | Current values that allow this branch (omit = any) |
| `set`        | New value assigned via `setVariable`               |

No matching branch → no-op (e.g. `opening` / `closing` need no extra guards). Presentation nodes (`visibleWhen`, GIF `onComplete`) remain unchanged.

Fan-out is multiple `onClick` effects, each targeting one variable with the same event name — not `variable` as an array. Click lists do not take `sound`; use control `sound` / `soundWhen`.

## Bounds interpolation (`transition`)

`boundsWhen` is layout: the target box when a condition is true. It does **not** imply motion. Interpolation is opt-in via the same `transition` object on the layout node (live) and on `view.state` branches (reserved for the host interpolator):

```json
"transition": { "durationMs": 120, "easing": "linear" }
```

| Field | Meaning |
| --- | --- |
| `durationMs` | Interpolation length. `0` snaps. Omitting `transition` is the same as `0`. |
| `easing` | `linear` (default), `ease`, `ease-in`, `ease-out`, `ease-in-out` |

Today the CSS path reads **node** `transition`. If `durationMs > 0`, the host adds `.skin-bounds--motion` and writes `--skin-bounds-duration` / `--skin-bounds-easing`. `prefers-reduced-motion: reduce` disables it. A later interpolator will also read `transition` on the triggering state-event branch (cube flip: one duration for the change); until then put duration on the nodes that slide.

Headspace drawers stay mounted at closed bounds. Toggle sets `open` / `closed`; `boundsWhen` on `view.eq.open` is the slide target; `transition: { durationMs: 120 }` on those nodes is what interpolates. Plus-nature 320 ↔ small uses `boundsWhen` without `transition` and snaps.

## Future: host-driven motion (not now)

Authors stay declarative. The host owns the clock; CSS owns the paint. No skin JavaScript. The old #17 clip/backend table (`sprite` / `css` / `clip` / `video` timelines) is retired — sprite sheets and video stay asset presentations (`gif`, `slideshow`), not a parallel sequencer.

| Motion kind | Owner | Typical use |
| --- | --- | --- |
| Ambient / hover / one-shot | `skin.css` (`@keyframes`, transitions) | Glow, hover wash, intro loop |
| State-driven | Manifest `transition` on the layout node (today) and later on `view.state` branches; host interpolates | Drawer slide, cube flip |
| Continuous / audio-reactive | Shared `drive` evaluator (same as viz layers) | Pulse with bass, idle float |

Host writes compositor-friendly results (`translate` / `scale` / `rotate`, or registered custom properties). Do not transition `left` / `top` / `width` / `height` (today’s `.skin-bounds--motion` does — a later fix). `framer-motion` stays out of the skin engine entirely — it is not a pack API and not a runtime dependency of skin rendering.

`prefers-reduced-motion` still applies. Velocity-preserving interruption is optional polish, not a requirement — discrete state toggles retargeting from the current value is enough.

## Cheap reservations (not now)

Small contract/runtime changes that keep a later 3D / game-UI skin tier from requiring a rewrite. None of this is needed for current bitmap or CSS skins. The durable asset is the **contract** (actions, binds, view state, conditions, pack format) — not the DOM presentation kinds. Adding a `scene` node later is the same move as adding `bitmapHorizontalSlider` beside `stripSlider`.

Do not invent a second transform, visibility, or event vocabulary while waiting.

### One transform vocabulary

Visualizer scene layers already have `drive` (`opacity`, `scale`, `translateX`, `translateY`, `rotation`) evaluated by `resolveDrive` against audio buckets and skin binds — see the [presentation contract](../../../docs/guides/presentation-contract.md). Skin layout nodes use a parallel model (`bounds`, `boundsWhen`, `style`) and do not consume drives.

When audio-reactive or 3D motion lands, reuse `LayerDriveMap` / `resolveDrive` on layout nodes. Extend `TransformDriveKey` with `z` / `rotateX` / `rotateY` / `perspective` rather than skin-only transform fields. `bounds` stays the layout box; drives compose on top (same split viz layers already have between `layout` and `drive`).

A first 3D path can be CSS `preserve-3d` over the existing DOM renderer so playlist/text faces stay real controls. WebGL belongs under that for glass, particles, and geometry DOM cannot do — not as a replacement compositor for interactive chrome.

### State-machine transitions

View `state` already snaps via `view.applyStateEvent`. Node `transition` is the live interpolator stub: `.skin-bounds--motion` + CSS variables. A cube flip is “on `togglePlaylist`, interpolate `main → playlist` over 600ms” — same `transition` object on that state-event branch, honored when the host interpolator lands. Root/per-node `animations` / `timelines` stay reserved blobs until that shape is chosen. Do not invent a second duration field.

### Version-gate before contribution parse

`pack.json` `minAppVersion` is checked only after a successful parse. `LayoutNode` is a closed tagged enum, so an unknown `type` (a future `scene` node) fails serde before the version message can fire. Read pack-level `minAppVersion` before validating contribution trees so old apps can say “needs Spiral x.y” instead of a parse error.

### Manifest capabilities

GPU code with pointer input and action access is a different trust tier from a bitmap pack. Reserve a `capabilities` array on the skin (or pack) manifest — e.g. `scene`, `actions` — surfaced at install, and eventually gated by the registry. Easier to introduce before those packs exist than after.

A scene-tier view should also declare a **declarative fallback view** (sandbox death, no WebGL, `prefers-reduced-motion`). The visualizer worker sandbox is already the GPU runtime; a scene-tier skin would invert containment (scene hosts DOM) and add two channels the viz sandbox does not have: pointer events in, validated `KNOWN_ACTIONS` out. Do not grow a second JS sandbox.

### Already reserved — do not reuse

| Field / surface | Hold for |
| --- | --- |
| Root and per-node `animations` / `timelines` | Host-driven motion specs (or unused). Not free-form JS, not a clip sequencer. |
| `window.clipMask` | Irregular chrome / GPU hit silhouette (unimplemented). Click-through today alpha-tests decoration bitmaps; a rotating mesh needs a GPU-side hit source, not a new window API. |