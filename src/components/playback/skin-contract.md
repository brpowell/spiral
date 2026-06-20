# Playback skin contract

Shared playback UI lives under `src/components/playback/` (`PlaybackTransport`, `NowPlayingMetadata`, `SeekBar`, `VolumeControl`, `QueueButton`, `VisualizerSlot`) and composes through `SkinShell` slot wrappers. Import from `src/components/playback` (barrel) or individual subfolders.

V1 components read `usePlayerStore` directly. **V2:** skin mode uses manifests (`skin.json` v1) that bind to the action catalog and data paths below via `SkinLayoutRenderer` — see `src/components/playback/skin/` and `src-tauri/skins/`.

## Action catalog

Named actions invoked by shared playback components. Skin authors wire controls to these identifiers.

| Action ID | Description |
| --- | --- |
| `player.togglePlayPause` | Toggle play/pause for the current track |
| `player.previousTrack` | Go to previous track |
| `player.nextTrack` | Go to next track |
| `player.cycleRepeat` | Cycle repeat mode: off → all → one |
| `player.toggleShuffle` | Toggle shuffle |
| `player.seek` | Seek to ratio 0–1 (payload: `{ ratio: number }`) |
| `player.setVolume` | Set volume 0–1 (payload: `{ volume: number }`) |
| `player.setBalance` | Set stereo balance −1…1 (payload: `{ balance: number }`; 0 = center) |
| `player.toggleMute` | Toggle mute |
| `player.clearSetList` | Stop playback and clear the set list (same as the set list modal Clear action) |
| `navigation.openAlbum` | Open album view for current track (payload: `{ albumKey: string }`) |
| `queue.openSetList` | Open the set list modal |
| `skin.openPicker` | Open Appearance (Skins section) |
| `skin.exit` | Exit skin mode |
| `skin.restoreMainWindow` | Hide skin mode and show the library window |
| `skin.minimize` | Minimize the skin-mode window |
| `skin.toggleAlwaysOnTop` | Toggle always-on-top for the skin window |
| `skin.togglePanel` | Toggle an in-view panel (payload: `{ panelId: string }` on the control node) |
| `skin.openPanel` | Open an in-view panel |
| `skin.closePanel` | Close an in-view panel |
| `visualizer.previous` | Cycle to the previous global visualizer pack |
| `visualizer.next` | Cycle to the next global visualizer pack |
| `playlist.setSource` | Select playlist view source (payload: `{ sourceId: string }` — `all`, `upNext`, or `playlist:{id}`) |
| `playlist.playTrack` | Play a track from the active playlist view (payload: `{ trackId: number }`) |
| `eq.setBand` | Set EQ band gain (payload: `{ band: number; gain: number }` — **band is 1-based**, gain in dB −14…+14; forces manual preset) |
| `eq.applyPreset` | Apply a named preset (payload: `{ presetId: string }`) |
| `eq.reset` | Flatten all bands to 0 dB and set preset to manual |
| `eq.setEnabled` | Toggle EQ processing (payload: `{ enabled: boolean }`; band values preserved when disabled) |
| `app.quit` | Quit Spiral (saves session and closes the app) |

## Data bind paths

Read-only paths for skin text, visibility, and disabled states. No scripting in V1/V2.

| Bind path | Type | Description |
| --- | --- | --- |
| `track.title` | `string` | Current track title |
| `track.artist` | `string \| null` | Primary artist |
| `track.metadataLine` | `string` | `{status} - {artist} - {title}` (scrolling-friendly) |

Text styles with `truncate: true` enable overflow scrolling. Set `scroll: "marquee"` for a seamless looping ticker (classic WMP); omit or use `bounce` for pause–scroll–snap-back.
| `track.album` | `string \| null` | Album name |
| `track.artUrl` | `string \| null` | Resolved album art URL |
| `track.durationSeconds` | `number \| null` | Track duration |
| `player.isPlaying` | `boolean` | `playbackState === "playing"` |
| `player.notPlaying` | `boolean` | `playbackState !== "playing"` |
| `player.playbackState` | `"playing" \| "paused" \| "stopped"` | Raw playback state |
| `player.positionSeconds` | `number` | Store position (use hook for live scrubber) |
| `player.repeatMode` | `"off" \| "all" \| "one"` | Repeat mode |
| `player.shuffle` | `boolean` | Shuffle enabled |
| `player.volume` | `number` | Volume 0–1 |
| `player.balance` | `number` | Stereo balance −1…1 (0 = center) |
| `player.muted` | `boolean` | Mute state |
| `player.canGoPrevious` | `boolean` | Previous control enabled |
| `player.canGoNext` | `boolean` | Next control enabled |
| `queue.length` | `number` | Active playback queue length |
| `player.hasTrack` | `boolean` | A track is loaded |
| `skin.alwaysOnTop` | `boolean` | Skin window pinned on top |
| `playback.source` | `"file" \| "cd" \| null` | Current playback source |
| `visualizer.name` | `string` | Display name of the active global visualizer |
| `visualizer.canGoPrevious` | `boolean` | More than one visualizer pack installed (wraps) |
| `visualizer.canGoNext` | `boolean` | Same as `visualizer.canGoPrevious` |
| `playlist.sourceLabel` | `string` | Display label for the active playlist view source |
| `playlist.trackCount` | `number` | Tracks in the active playlist view |
| `playlist.hasTracks` | `boolean` | Active playlist view has at least one track |

### Equalizer bind paths (`eq.*`)

Band indices in bind paths and `eq.setBand` actions are **1-based** (1 = 31 Hz … 10 = 16 kHz). The store uses 0-based indices internally.

| Bind path | Type | Description |
| --- | --- | --- |
| `eq.enabled` | `boolean` | EQ processing on |
| `eq.presetId` | `string` | Active preset id or `"manual"` |
| `eq.isManual` | `boolean` | `presetId === "manual"` |
| `eq.presetLabel` | `string` | Display name for active preset |
| `eq.band.1` … `eq.band.10` | `number` | Band gain in dB (−14…+14) |

### Panel bind paths (`skin.panel.{panelId}.*`)

Dynamic per-view panel ids from `views.*.panels`. Typical ids: `eq`, `playlist`, `visChooser`.

| Bind path | Type | Description |
| --- | --- | --- |
| `skin.panel.{id}.open` | `boolean` | Drawer/overlay is open (drives `boundsWhen` slide targets) |
| `skin.panel.{id}.closed` | `boolean` | Negation of `.open` |
| `skin.panel.{id}.revealed` | `boolean` | Panel content mounted (before/during slide; hidden after close animation) |
| `skin.panel.{id}.settled` | `boolean` | Slide animation complete at the current open/closed target |
| `skin.panel.{id}.openSettled` | `boolean` | `.open` and `.settled` (use for close controls that must not appear mid-slide) |

## Window (`skin.json` → `window`)

Skin mode always uses a **frameless** transparent native window. There is no built-in title bar — authors declare window chrome in the layout and wire `skin.*` / `app.quit` actions (see below). Right-click still opens a native context menu (pin, Appearance, return to library) as a fallback.

| Field | Purpose |
| --- | --- |
| `background` | Full-window background image path (under the skin pack root) |
| `clipMask` | Reserved: PNG alpha mask for shaped windows (not yet applied at runtime) |
| `defaultWidth` / `defaultHeight` | Initial size when no per-skin position is saved (logical px); include chrome drawn in the layout |
| `minWidth` / `minHeight` / `maxWidth` / `maxHeight` | Passed to `setMinSize` / `setMaxSize` |
| `resizable` | When `false`, the window is fixed to the default size |
| `snapEnabled` | When `false`, edge snapping is disabled (useful for fixed chrome skins) |

Position is remembered **per skin id** in local storage. Sizes are stored in **logical** pixels to behave correctly on Retina displays.

### Layout modes

| Mode | Audience | Chrome pattern |
| --- | --- | --- |
| `canvas` | WMP classic bitmap | `buttonGroup` + `dragRegion` / `decoration.dragRegion` on absolute bounds |
| `slots` (default) | CSS flex + primitives | `header` region with `dragRegion: true` + primitive `button` nodes |

Use `dragRegion` nodes (canvas), `decoration` + `dragRegion: true`, or `dragRegion: true` on a `region` / `row` / `column` (slots) for window drag handles. Runtime maps these to `data-tauri-drag-region="deep"` so clicks on non-interactive areas inside the region move the window; interactive controls opt out with `data-tauri-drag-region="false"`.

Classic WMP skins often use a composite **button group** (`presentation.kind`: `buttonGroup`) for window chrome (expand / minimize / close). Each element maps a color in `positionMap` to an action:

| Field | Purpose |
| --- | --- |
| `assetBase` | Composite button image under `assets/` without extension |
| `positionMap` | Color-key PNG for hit testing (e.g. `buttons/window-chrome-map`) — **authoritative**; WMP `mappingImage` |
| `elements` | `{ mappingColor, action }` pairs — hex colors match map pixels |
| `animatedHover` | When true, hover uses `{assetBase}-hover.gif` |

Place drag regions on non-interactive chrome with a **lower `zIndex` than controls** so buttons and sliders stay clickable.

## Layout modes (`views.*`)

| Field | Values | Purpose |
| --- | --- | --- |
| `layoutMode` | `slots` (default), `canvas` | `slots` fills `SkinShell` regions; `canvas` places nodes with `bounds` |
| `canvas.width` / `canvas.height` | px | Stage size when `layoutMode` is `canvas` |
| `bounds` | `{ x, y, w, h, zIndex? }` | Absolute position on the canvas (logical px) |
| `dragRegion` | node type, `decoration` flag, or `true` on `region` / `row` / `column` | Window drag handle |

Root layout for canvas views is typically `{ "type": "canvas", "children": [ … ] }`.

Canvas skins may ship a pack-level `stylesheet` for control styling scoped via `classPrefix` on primitive nodes.

## Digit time (`presentation.kind`: `digitStrip`)

Classic WMP skins show elapsed or remaining time as **MM:SS** using a horizontal digit strip (`numbers.bmp` / `time.png`: 12 frames × 14px — digits 0–9, colon, minus). Layout node type `time` with `digitStrip` presentation:

| Field | Purpose |
| --- | --- |
| `strip` | Asset path under `assets/` without extension |
| `frameWidth` / `frameHeight` | One digit/sign window size (typically 14×15) |
| `slots` | `{ role, x }` windows: `sign`, `minuteTens`, `minuteOnes`, `secondTens`, `secondOnes` |
| `signFrameElapsed` / `signFrameRemaining` | Strip frame indices for `:` vs `-` (defaults 10, 11) |

Click toggles elapsed ↔ remaining (matches WMP `SetTimeShowState`). Use `visibleWhen: "player.hasTrack"` to hide when idle.

## Animated GIF (`presentation.kind`: `gif`)

Classic WMP skins use looping GIFs for status chrome (e.g. T3 `m_idle.gif` / `m_playback.gif`). Use a `decoration` node with `gif` presentation:

| Field | Purpose |
| --- | --- |
| `assetBase` | Path under `assets/` without extension (file must be `{assetBase}.gif`) |

WMP source GIFs use magenta (`#FF00FF`) as a fake transparent color — bake real alpha before bundling (see `chroma_gif` in `scripts/import-skynet-wmp-assets.sh`). Raw magenta GIFs render as solid pink.

Toggle with `visibleWhen` binds such as `player.isPlaying` and `player.notPlaying`.

## Playlist view (`type`: `playlist`)

Reusable compact track list for skin playlist drawers and panels. Sources: **All tracks** (library, title sort), **Up Next** (tracks after the current item in playback order), and each user-defined playlist (sorted by title).

Wire a `playlist` node with `presentation.kind`: `compact`:

| Field | Purpose |
| --- | --- |
| `showDropdown` | Source selector at top (default `true`) |
| `showDuration` | Duration column (default `true`) |
| `classPrefix` | Optional CSS scope class |

Dropdown changes invoke `playlist.setSource`; row clicks invoke `playlist.playTrack`. Bind `playlist.sourceLabel`, `playlist.trackCount`, or `playlist.hasTracks` for chrome text and visibility.

## Skin window actions

| Action ID | Description |
| --- | --- |
| `skin.openPicker` | Open Appearance (Skins section) |
| `skin.exit` | Exit skin mode |
| `skin.restoreMainWindow` | Hide skin mode and show the library window |
| `skin.minimize` | Minimize the skin-mode window |
| `skin.toggleAlwaysOnTop` | Toggle always-on-top for the skin window |
| `app.quit` | Quit Spiral |

## Visualizer (`skin.json` → `visualizer`)

Skins declare pack reference (optional), shell placement, and sizing separately from the layout `visualizer` control node.

| Field | Values | Purpose |
| --- | --- | --- |
| `pack` | pack id, `global`, or omit | Pack id pins a visualizer; `global`/omit follows the active picker |
| `preset` | `bars`, `wave`, `spectrum` | Deprecated — maps to built-in pack ids |
| `placement` | `top`, `bottom` (default) | Where the visualizer band sits in `SkinShell` |
| `display` | `mini`, `panel` (default `mini`) | `mini` = compact strip; `panel` = fills the visualizer slot |
| `size.width` | `fill` or px | Slot width |
| `size.height` | `flex`, `fill`, or px | `flex` grows to use remaining shell height (typical top panel layout) |
| `size.minHeight` / `maxHeight` | px | Optional bounds |

Pinned pack example:

```json
"visualizer": {
  "pack": "wave",
  "placement": "top",
  "display": "panel",
  "size": { "width": "fill", "height": "flex" }
}
```

Follow global picker (omit `pack` or use `"global"`):

```json
"visualizer": {
  "placement": "top",
  "display": "panel",
  "size": { "width": "fill", "height": "flex" }
}
```

## SkinShell slots

Skin layout nodes map to shell slots, not ad-hoc markup:

| Slot | Typical content |
| --- | --- |
| `header` | Transport or title row |
| `art` | Album art |
| `info` | Title / artist / album |
| `controls` | Transport + seek |
| `visualizer` | `VisualizerSlot` |
| `footer` | Volume, queue, extra actions |

Unset slots receive the V1 default Spiral layout. Skins override individual slots without rewriting the shell.

## Visualizer cross-window data pipe

The Web Audio `AnalyserNode` is created in the main window on the shared playback bus (`src/lib/playback/audioOutput.ts`, consumed by `VisualizerSlot` / `SceneRenderer`). File playback taps Howler's master gain; CD playback taps the PCM pipeline gain — both route through the same analyser.

When skin mode runs in a **second Tauri webview**, it must not instantiate a second analyser. Plan:

1. **`VisualizerDataProvider`** (main window): samples `getAnalyser()` each animation frame and publishes frequency/time-domain frames (e.g. Tauri event or shared channel).
2. **`VisualizerSlot` subscriber** (skin-mode webview): receives frames and passes them to a renderer; the main window continues to read the analyser locally via the same slot.

`VisualizerSlot` is the layout integration point — swap the inner renderer per skin without changing transport or seek components.

**V1.5 status:** `VisualizerDataProvider` in `src/lib/visualizerDataBridge.ts` publishes 64-bin frames from the main window; skin mode subscribes via `useVisualizerFrame` and `VisualizerSlot`.

## Shared hooks

| Hook | Purpose |
| --- | --- |
| `usePlaybackProgress` | Seek drag state, live RAF position while playing, scrubber value |

Used by `SeekBar`; import this hook in custom skin seek controls to avoid duplicating seek logic.

## Future: declarative skin animations (post-epic)

Not in V1/V2 scope. Documented so the manifest/renderer do not assume static chrome only.

Classic WMP skins used timed show/hide, frame sequences, and event-driven transitions (e.g. a “door opening” reveal on load or play). Spiral should support the same *feel* via **declarative timelines** — not skin scripting.

**Triggers** (presentation events, separate from the action catalog): e.g. `skin.loaded`, `view.activated`, `player.playbackState` transitions, `track.changed`.

**Targets**: layout nodes with stable `id`s, especially on the **absolute overlay layer** (decorative chrome, masks, non-interactive regions).

**Timeline backends** (pluggable, like `presentation.kind`):

| Kind | Typical use |
| --- | --- |
| `sprite` | Frame sequence from a sheet + grid descriptor (most WMP-like) |
| `css` | `@keyframes` driven by bind→`data-*` on trigger |
| `clip` | Animated window mask / reveal (door opening) |
| `video` | Short WebM/WebP one-shot or loop in `assets/` |

**V2 guardrails** (keep iteration cheap later): absolute/overlay nodes in schema; node `id`s; sprite grid descriptor reserved; bind→attribute channel shared with CSS controls; respect `prefers-reduced-motion`.

See spiral-desktop [#17](https://github.com/brpowell/spiral-desktop/issues/17) for full planning notes.
