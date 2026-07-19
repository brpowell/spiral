# Visualizer host contract

Sibling to [skin-contract.md](../playback/skin-contract.md). Describes what Spiral provides to VizScene layers each frame — visualizers declare a `scene` (VizScene) on `surfaces.default`; the host builds context.

## Resolution order (active visualizer)

1. **Skin override** — `skin.json` → `visualizer.id` when set to a visualizer contribution id (skin mode only).
2. **Skin global** — omit `id`, or set `id: "global"`, to follow the active visualizer picker in skin mode.
3. **Global default** — user preference from the visualizer picker.
4. **Fallback** — built-in `spiral.core.visualizer.bars`.

## Surfaces

Visualizer manifests require `surfaces.default`. Only `default` is reserved for now; slot placement (`mini` / `panel` skin display, expand overlay) still uses layout variants, but they all render the same scene.

Renderers may still soften motion via `flags.reducedMotion` on the host context.

## Visualizer vs VizScene vs VizRenderer

| Concept | Folder | Manifest | Job |
| --- | --- | --- | --- |
| **Visualizer** | `visualizers/` | `viz.json` | Product composition: a VizScene on `surfaces.default` |
| **VizScene** | (inside viz.json) | `surfaces.default.scene` | Layer tree for the reserved surface |
| **VizRenderer** | `renderers/` | `renderer.json` + entry JS | Draw one canvas or webgl layer from a `VizFrame` |

Effective ids are fully qualified: `authorId.packId.type.contributionId` (e.g. `spiral.core.visualizer.wave`, `spiral.core.renderer.wave`).

Canvas and webgl layers both reference a fully-qualified renderer contribution id (e.g. `spiral.core.renderer.neon-tunnel`).

## VisualizerContext (per frame)

```typescript
interface VisualizerContext {
  surface: "default";
  size: { width: number; height: number; dpr: number };

  audio: {
    bins: readonly number[];       // 64 frequency bins, 0–255
    isPlaying: boolean;
    playbackState: "playing" | "paused" | "stopped";
    volume: number;                // 0–1
    overallEnergy: number;         // RMS from bins, 0–1
    bassEnergy: number;            // low-frequency bucket RMS, 0–1
    midEnergy: number;             // mid-frequency bucket RMS, 0–1
    trebleEnergy: number;          // high-frequency bucket RMS, 0–1
  };

  bind(path: SkinBindPath): string | number | boolean | null;

  colors: {
    palette: string[];             // album art extraction, or host fallback
    tokens: Record<string, string>; // active theme CSS tokens
  };

  flags: {
    reducedMotion: boolean;
  };
}
```

Built via `src/components/visualizer/context.ts` from player store, theme, album palette, and skin bind resolver.

## VizRenderer author API

The host builds a normalized `VizFrame` each tick (`vizRendererApi.ts`) and loads source via `read_viz_renderer_source`. Both engines run in the same **Worker + OffscreenCanvas** sandbox (`sandbox/SandboxedVizRenderer.ts`): network APIs are stubbed, frames are transferable, and a frame-budget watchdog can terminate stuck workers. The worker returns an `ImageBitmap` for the host to blit.

### canvas2d (`engine: "canvas2d"`)

`create() → { render(ctx, frame, params) }`

### webgl (`engine: "webgl"`)

`create({ canvas, THREE }) → { render(frame, params), resize?, dispose? }`

The host injects the app’s bundled `three` — packs must not import or vendor three.js. Prefer `OffscreenCanvas` (not `document`) for scratch textures.

Stock WebGL: `spiral.core.renderer.neon-tunnel`.

## Bind paths

Reuse the skin bind catalog — read-only each frame:

| Path | Type | Description |
| --- | --- | --- |
| `track.title` | string | Current track title |
| `track.artist` | string | Artist line |
| `track.metadataLine` | string | Formatted metadata |
| `track.album` | string | Album title |
| `track.artUrl` | string | Resolved art URL |
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

Subscribers use `useVisualizerFrameRef()` in the skin webview. Renderer drawing merges remote bins with local palette/theme context.

## Pack manifests

- Visualizer: [visualizer-pack-guide.md](../../docs/guides/visualizer-pack-guide.md), `src-tauri/schemas/viz-v1.schema.json`
- Renderer: `src-tauri/schemas/renderer-v1.schema.json`

Canvas `renderer` fields must be fully-qualified renderer ids (e.g. `spiral.core.renderer.bars`). Params are validated on load (bounds, asset paths).

## Install paths

| Kind | Location |
| --- | --- |
| Built-in | `src-tauri/packs/builtin/<packId>/` |
| User | `{app_data}/packs/{workshop,installed}/` |

Contributions are discovered under type folders (`visualizers/`, `renderers/`, …). Effective id = `authorId.packId.type.contributionId`.

## Related

- [Playback skin contract](../playback/skin-contract.md) — visualizer slot placement in skins
- [Spiral pack format](../../docs/guides/spiral-pack-format.md) — pack wrapper and type folders
