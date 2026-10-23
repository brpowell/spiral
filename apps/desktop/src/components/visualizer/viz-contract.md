# Visualizer host contract

Sibling to [skin-contract.md](../playback/skin-contract.md). Describes what Spiral provides to VizScene layers each frame — visualizers declare `children` (VizScene); the host builds context.

## Resolution order (active visualizer)

1. **Skin override** — `skin.json` → `visualizer.id` when set to a visualizer contribution id (skin mode only).
2. **Skin global** — omit `id`, or set `id: "global"`, to follow the active visualizer picker in skin mode.
3. **Global default** — user preference from the visualizer picker.
4. **Fallback** — built-in `spiral.visualizer.bars`.

## Layers

Visualizer manifests list their layers in top-level `children`. Slot placement (`mini` / `panel` skin display, expand overlay) still uses layout variants, and every slot renders that same list.

Draw modules may still soften motion via `flags.reducedMotion` on the host context.

## Visualizer vs VizScene vs draw module

| Concept | Folder | Manifest / file | Job |
| --- | --- | --- | --- |
| **Visualizer** | `visualizers/` | `viz.json` | Product composition: a VizScene (`children`) |
| **VizScene** | (inside viz.json) | `children` | Layer list |
| **Draw module** | same visualizer folder | `entry` JS (e.g. `index.js`) | Draw one canvas or webgl layer from a `VizFrame` |

Effective visualizer ids are fully qualified: `publisherId.packId.visualizer.contributionId` (e.g. `spiral.visualizer.wave`).

Canvas and webgl layers name a relative `entry` script in the visualizer folder (e.g. `"entry": "index.js"`). Layer `kind` selects the backend (`canvas` → canvas2d, `webgl` → webgl). Tunables live as constants inside the entry script — `viz.json` does not pass a params bag.

## VisualizerContext (per frame)

```typescript
interface VisualizerContext {
  scene: "default";
  size: { width: number; height: number; dpr: number };

  audio: {
    bins: readonly number[];       // 128 bins at fft size 256, values 0–255
    isPlaying: boolean;
    playbackState: "playing" | "paused" | "stopped";
    volume: number;                // 0–1
    overallEnergy: number;         // RMS from bins, 0–1
    bassEnergy: number;            // low-frequency bucket RMS, 0–1
    midEnergy: number;             // mid-frequency bucket RMS, 0–1
    trebleEnergy: number;          // high-frequency bucket RMS, 0–1
  };

  bind(path: SkinBindPath): string | number | boolean | null;

  theme: {
    name: string;
    tokens: Record<string, string>; // active theme CSS tokens
  };

  flags: {
    reducedMotion: boolean;
  };

  trackMetadata: VizFrameTrack;
}
```

Built via `src/components/visualizer/context.ts` from player store, theme, album palette, and skin bind resolver.

## Draw-module author API

The host builds a normalized `VizFrame` each tick (`vizRendererApi.ts`) and loads source via `read_viz_layer_source` (visualizer id + entry). Both engines run in the same **Worker + OffscreenCanvas** sandbox (`sandbox/SandboxedVizRenderer.ts`): entry source is parsed as an ES module and rejected if it has any `import`/`export … from`, `import()`, `import.meta`, or references to `eval`, `Function`, `importScripts`, `Worker`, `SharedWorker`, `createObjectURL` or `WebAssembly` (`sandbox/vizSourceGuard.ts`, checked on the host and again in the worker), network and code-loading APIs are stubbed in the worker, frames are transferable, and a frame-budget watchdog can terminate stuck workers. Init also has a hard timeout (2s canvas2d / 5s webgl); if `ready` never arrives the host terminates the worker. Effect cleanup aborts in-flight init so a hung `create()` cannot leak a thread. The worker returns an `ImageBitmap` for the host to blit. When the host receives a fatal terminate (watchdog, context loss, budget overrun), it recreates the sandbox automatically, capped at a short restart window so a broken pack cannot loop forever.

**Resource budgets** (`sandbox/resourceBudgets.ts`): CSS/DPR viewport is clamped so the backing store stays ≤ 2560×1440 and ≤ ~3.7MP; oversized audio transfers, pack-grown canvases, returned bitmaps, or entry source (>512KB) terminate the worker. Soft/hard frame-time budgets and consecutive overrun kills remain as before.

**Worker globals** (`sandbox/workerGlobalLockdown.ts`): allowlist-first. Pack code sees language intrinsics, canvas/WebGL surface APIs, `navigator` (THREE capability probes), timers (no string eval), and message-event types — not `fetch`, `Worker`, `eval`/`Function`, `WebAssembly`, WebRTC, `SharedArrayBuffer`/`Atomics`, storage, `crypto`, or raw `postMessage`/`close` (host keeps native refs). Host shape-checks inbound worker messages and pixel-budgets returned bitmaps before blit. `webglcontextlost` terminates that layer only. Add to the allowlist only when a concrete pack need requires it.

**Worker CSP** (`sandbox/workerCsp.ts`): a dedicated worker takes its CSP from its own script response, not from the page, and Tauri only attaches CSP to HTML. The worker script is served with `default-src 'none'; script-src 'self' blob:` (by `src-tauri/src/viz_worker_csp.rs` in packaged builds, by a plugin in `vite.config.ts` under `tauri dev`), so pack code cannot compile strings, load remote or `asset:` modules (JS or JSON), or fetch. The worker probes for that policy before loading a pack and refuses to run without it. `Function.prototype.constructor` (and the async/generator variants) is also stubbed after lockdown. Track image ids on the wire are opaque tokens, not file paths.

WebView **CSP** (`src-tauri/tauri.conf.json`) reinforces this for the page: production `connect-src` allows only IPC + the local asset protocol (no remote `https:`), `frame-src` / `object-src` are `'none'`, and `worker-src` is limited to `'self' blob:`. Pack media still loads via `asset:` / `asset.localhost` under `img-src` / `media-src`.

Declarative **image/video** layers stay on the host DOM. Their `src` is built only from pack-relative `asset` (`assets/…`) after path checks — never from binds or track `filePath`. `track.artUrl` is an app-resolved cover URL for binds/drives only. Draw modules receive the cover as `frame.trackMetadata.art`, not that URL.

### canvas (`kind: "canvas"` → canvas2d)

`create() → { render(ctx, frame) }`

`frame` is one draw tick. Field notes live on the types in `vizRendererApi.ts` and `vizTrack.ts`; the shape is:

```typescript
interface VizFrame {
  audio: VizFrameAudio;
  time: VizFrameTime;       // scene clock, not playback position
  size: VizFrameSize;       // CSS pixels; dpr is already applied
  theme: VizFrameTheme;     // { name, tokens }
  flags: { reducedMotion }; // host still delivers every frame
  trackMetadata: VizFrameTrack;
}

interface VizFrameAudio {
  frequencies: Float32Array; // 0–1, low band first. 128 bins at fft size 256
  waveform: Float32Array;    // −1..1, or empty. Not always a real waveform
  isPlaying: boolean;
  overallEnergy: number;     // RMS of every bin, 0–1
  bassEnergy: number;        // lowest 8% of bins, 0–1
  midEnergy: number;         // 8%–45%, 0–1
  trebleEnergy: number;      // 45%–end, 0–1
}

interface VizFrameTime {
  elapsedMs: number; // since the scene was shown. 0 on the first frame
  deltaMs: number;   // since the previous frame, capped at 64
}

interface VizFrameSize {
  width: number;  // CSS pixels
  height: number; // CSS pixels
  dpr: number;    // already applied, capped at 2.5. Do not scale coordinates by it
}

interface VizFrameTheme {
  name: string;                    // "Obsidian", "Sprig", …
  tokens: Record<string, string>; // color-bg, color-accent, font-ui, …
}

interface VizFrameTrack {
  title: string;            // "" when nothing is loaded
  album: string | null;
  artists: {                // performer credits, in listed order
    name: string;
    portrait: ImageBitmap | null; // ≤512px. null when the library has none
  }[];
  art: ImageBitmap | null;  // album cover, ≤512px. null when there is none
  artColors: string[];      // cover swatches, or the host fallback palette
}
```

Covers and portraits are already decoded. Pass them to `ctx.drawImage`. Read them from the current frame; they stay valid only while that same image is still showing. Draw modules cannot fetch images themselves.

### webgl (`kind: "webgl"`)

`create({ canvas, THREE }) → { render(frame), resize?, dispose? }`

The host injects the app’s bundled `three` — packs must not import or vendor three.js. Prefer `OffscreenCanvas` (not `document`) for scratch textures.

Stock WebGL: `spiral.visualizer.neon-tunnel` (`entry`: `index.js`).

## Bind paths

Reuse the skin bind catalog — read-only each frame:

| Path | Type | Description |
| --- | --- | --- |
| `track.title` | string | Current track title |
| `track.artist` | string | Artist line |
| `track.metadataLine` | string | Formatted metadata |
| `track.album` | string | Album title |
| `track.artUrl` | string | Host-resolved cover art URL from `artPath` (not a library `filePath`; not used as media-layer `src`) |
| `track.durationSeconds` | number | Track length |
| `player.isPlaying` | boolean | Playing |
| `player.notPlaying` | boolean | Paused or stopped |
| `player.playbackState` | string | `playing` \| `paused` \| `stopped` |
| `player.positionSeconds` | number | Playback position |
| `player.repeatMode` | string | Repeat mode |
| `player.shuffle` | boolean | Shuffle on |
| `player.volume` | number | Volume 0–1 |
| `player.muted` | boolean | Muted |
| `player.canGoPrevious` | boolean | Previous available |
| `player.canGoNext` | boolean | Next available |
| `queue.length` | number | Queue length |
| `player.hasTrack` | boolean | Track loaded |
| `skin.alwaysOnTop` | boolean | Skin window always on top |
| `playback.source` | string \| null | `"file"` or `"cd"` when a track is loaded |

## Cross-window frame payload

Skin-mode webview does not run a local analyser. The main window samples the shared analyser bus and emits a full frame via `visualizerDataBridge`:

```typescript
interface VisualizerFramePayload {
  bins: number[];     // frequencyBinCount values, 0–255 (128 at fftSize 256)
  waveform: number[]; // fftSize normalized samples, −1..1 (256 at fftSize 256)
  overallEnergy: number;
  bassEnergy: number;
  midEnergy: number;
  trebleEnergy: number;
}
```

Subscribers use `useVisualizerFrameRef()` in the skin webview. Layer drawing merges remote bins with local palette/theme context.

## Pack manifests

- Visualizer: [`viz-v1.schema.json`](https://raw.githubusercontent.com/brpowell/spiral/main/libs/spk-format/schemas/viz-v1.schema.json)

Canvas and webgl `entry` fields must be a relative `.js` filename in the visualizer folder (e.g. `index.js`). Asset paths and layout are validated on load.

## Install paths

| Kind | Location |
| --- | --- |
| Built-in | `src-tauri/packs/builtin/<packId>/` |
| User | `{app_data}/packs/installed/`, `<Spiral Library>/Packs/` |

Contributions are discovered under type folders (`visualizers/`, …). Effective id = `publisherId.packId.type.contributionId`.

## Related

- [Playback skin contract](../playback/skin-contract.md) — visualizer slot placement in skins
