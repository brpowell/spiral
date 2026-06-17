# Visualizer host contract

Sibling to [skin-contract.md](../playback/skin-contract.md). Describes what Spiral provides to scene layers each frame — packs declare `scene[]` per surface; the host builds context.

## Resolution order (active pack)

1. **Skin override** — `skin.json` → `visualizer.pack` when set to a pack id (skin mode only).
2. **Skin global** — omit `pack`, or set `pack: "global"`, to follow the active visualizer picker in skin mode.
3. **Global default** — user preference from the visualizer picker.
4. **Fallback** — built-in `bars`.

Legacy `visualizer.preset` in skins maps to built-in pack ids: `bars` → `bars`, `wave` → `wave`, `spectrum` → `spectrum`.

## Surfaces

| Surface | Trigger |
| --- | --- |
| `mini` | `VisualizerSlot` with `variant="mini"` and not expanded |
| `panel` | Skin shell slot (`variant="dock"`) or skin `display: "panel"` |
| `expanded` | Mini expand overlay |

Pack manifests require `surfaces.default`. Optional `mini`, `panel`, and `expanded` entries override it. At runtime the host resolves all three surfaces before render.

When `prefers-reduced-motion` is set, the host resolves `reducedSurfaces[surface]`, then `reducedSurfaces.default`, then the normal surface scene.

## VisualizerContext (per frame)

```typescript
interface VisualizerContext {
  surface: "mini" | "panel" | "expanded";
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

## Pack manifest (`viz.json` v1)

See [visualizer-pack-guide.md](../../docs/visualizer-pack-guide.md) and `src-tauri/visualizers/schema/viz-v1.schema.json`.

Canvas layers reference built-in renderer ids (`bars`, `wave`, `spectrum`). Params are validated on load (renderer allowlist, param bounds, asset paths).

## Install paths

| Kind | Location |
| --- | --- |
| Built-in | `src-tauri/visualizers/builtin/<id>/` |
| User | `<app data>/visualizers/<id>/` |

Folder name = pack id. User packs with the same id as a built-in override the built-in in the picker list.

## Related

- [Playback skin contract](../playback/skin-contract.md) — visualizer slot placement in skins
- [Visualizer iteration plan](../../docs/visualizer-iteration-plan.md) — roadmap and phases
