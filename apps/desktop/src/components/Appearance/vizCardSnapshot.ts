import { useEffect, useState } from "react";
import { vizMediaLayerUrl } from "../../lib/presentation/assets";
import { OBSIDIAN_DEFAULT_TOKENS } from "../../lib/theme";
import type { Visualizer } from "../visualizer/types";
import { SandboxedVizRenderer } from "../visualizer/sandbox/SandboxedVizRenderer";
import { resolveLayout, type VizSceneLayer } from "../visualizer/scene/types";
import { EMPTY_VIZ_TRACK } from "../visualizer/vizTrack";
import {
  isSafeVizEntry,
  type VizFrame,
  type VizRendererEngine,
} from "../visualizer/vizRendererApi";
import { useVisualizerStore } from "../../store/useVisualizerStore";
import { useVisualizerPalette } from "../visualizer/context";
import {
  generateDemoVisualizerFrame,
  VIZ_CARD_DEMO_SNAPSHOT_MS,
} from "./vizCardPreviewAudio";

const VIZ_CARD_SNAPSHOT_WIDTH = 320;
const VIZ_CARD_SNAPSHOT_HEIGHT = 200;

type SnapshotResult =
  { src: string; status: "ready" } | { src: null; status: "error" };

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<SnapshotResult>>();
const waiters: Array<() => void> = [];
let queueRunning = false;

function layerSandboxEngine(
  kind: VizSceneLayer["kind"],
): VizRendererEngine | null {
  if (kind === "canvas") return "canvas2d";
  if (kind === "webgl") return "webgl";
  return null;
}

/** Active theme's tokens (read from CSS), falling back to Obsidian's. */
function snapshotThemeTokens(): Record<string, string> {
  const style =
    typeof document === "undefined"
      ? null
      : getComputedStyle(document.documentElement);
  return Object.fromEntries(
    Object.entries(OBSIDIAN_DEFAULT_TOKENS)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, fallback]) => [
        key,
        style?.getPropertyValue(`--${key}`).trim() || fallback,
      ]),
  );
}

/** Snapshots bake in the accent tint and palette, so they are cached per pair. */
function snapshotCacheKey(
  visualizerId: string,
  palette: readonly string[],
): string {
  return `${visualizerId}|${snapshotThemeTokens()["color-accent"]}|${palette.join(",")}`;
}

function buildSnapshotFrame(
  width: number,
  height: number,
  dpr: number,
  palette: readonly string[],
): VizFrame {
  const demo = generateDemoVisualizerFrame(VIZ_CARD_DEMO_SNAPSHOT_MS);
  const frequencies = new Float32Array(demo.bins.length);
  for (let i = 0; i < demo.bins.length; i++) {
    frequencies[i] = (demo.bins[i] ?? 0) / 255;
  }
  return {
    audio: {
      frequencies,
      waveform: Float32Array.from(demo.waveform),
      isPlaying: true,
      overallEnergy: demo.overallEnergy,
      bassEnergy: demo.bassEnergy,
      midEnergy: demo.midEnergy,
      trebleEnergy: demo.trebleEnergy,
    },
    time: { elapsedMs: VIZ_CARD_DEMO_SNAPSHOT_MS, deltaMs: 16 },
    size: { width, height, dpr },
    theme: {
      name: "Obsidian",
      tokens: snapshotThemeTokens(),
    },
    flags: { reducedMotion: false },
    trackMetadata: {
      ...EMPTY_VIZ_TRACK,
      artColors: [...palette],
    },
  };
}

function canvasToObjectUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("failed to encode snapshot"));
        return;
      }
      resolve(URL.createObjectURL(blob));
    }, "image/png");
  });
}

async function renderSandboxLayers(
  visualizerId: string,
  layers: VizSceneLayer[],
  width: number,
  height: number,
  dpr: number,
  palette: readonly string[],
): Promise<HTMLCanvasElement> {
  const composite = document.createElement("canvas");
  composite.width = Math.max(1, Math.floor(width * dpr));
  composite.height = Math.max(1, Math.floor(height * dpr));
  const ctx = composite.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, composite.width, composite.height);

  for (const layer of layers) {
    const engine = layerSandboxEngine(layer.kind);
    if (!engine || !isSafeVizEntry(layer.entry)) continue;

    const rect = resolveLayout(layer.layout, width, height);
    if (rect.w <= 0 || rect.h <= 0) continue;

    const layerCanvas = document.createElement("canvas");
    const sandbox = await SandboxedVizRenderer.create({
      canvas: layerCanvas,
      visualizerId,
      entry: layer.entry,
      engine,
      width: rect.w,
      height: rect.h,
      dpr,
    });

    try {
      // Fresh frame each layer — typed arrays are transferred to the worker.
      const frame = buildSnapshotFrame(rect.w, rect.h, dpr, palette);
      await sandbox.postFrameAndWait(frame);
      ctx.drawImage(
        layerCanvas,
        rect.x * dpr,
        rect.y * dpr,
        rect.w * dpr,
        rect.h * dpr,
      );
    } finally {
      sandbox.dispose();
    }
  }

  return composite;
}

async function snapshotFromVisualizer(
  visualizer: Visualizer,
  palette: readonly string[],
): Promise<string> {
  const layers = visualizer.children;
  const sandboxLayers = layers.filter((layer) =>
    layerSandboxEngine(layer.kind),
  );

  if (sandboxLayers.length > 0) {
    const canvas = await renderSandboxLayers(
      visualizer.id,
      sandboxLayers,
      VIZ_CARD_SNAPSHOT_WIDTH,
      VIZ_CARD_SNAPSHOT_HEIGHT,
      1,
      palette,
    );
    return canvasToObjectUrl(canvas);
  }

  const packDir = visualizer.packDir;
  if (packDir) {
    for (const layer of layers) {
      const url = vizMediaLayerUrl(packDir, layer);
      if (url) return url;
    }
  }

  throw new Error(`no snapshotable layers for ${visualizer.id}`);
}

function pumpQueue(): void {
  if (queueRunning) return;
  const next = waiters.shift();
  if (!next) return;
  queueRunning = true;
  void Promise.resolve()
    .then(next)
    .catch(() => {
      // Rejection is forwarded to the enqueue() caller.
    })
    .finally(() => {
      queueRunning = false;
      pumpQueue();
    });
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waiters.push(() => task().then(resolve, reject));
    pumpQueue();
  });
}

/**
 * Capture one demo frame of a visualizer (serialised). Cached for the window
 * lifetime. Does not revoke URLs — Appearance window is short-lived relative
 * to main, and cards remount often enough that cache hits matter more.
 */
function requestVizCardSnapshot(
  visualizerId: string,
  load: (id: string) => Promise<Visualizer>,
  palette: readonly string[],
): Promise<SnapshotResult> {
  const key = snapshotCacheKey(visualizerId, palette);
  const cached = cache.get(key);
  if (cached) return Promise.resolve({ src: cached, status: "ready" });

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = enqueue(async (): Promise<SnapshotResult> => {
    try {
      const visualizer = await load(visualizerId);
      const src = await snapshotFromVisualizer(visualizer, palette);
      cache.set(key, src);
      return { src, status: "ready" };
    } catch (err) {
      console.error(`[viz-card-snapshot] failed for ${visualizerId}`, err);
      return { src: null, status: "error" };
    } finally {
      inflight.delete(key);
    }
  });

  inflight.set(key, promise);
  return promise;
}

export function useVizCardSnapshot(visualizerId: string): string | null {
  const getVisualizer = useVisualizerStore((s) => s.getVisualizer);
  // Current track's cover colors, or Spiral's default when it has none.
  const palette = useVisualizerPalette();
  const cacheKey = visualizerId ? snapshotCacheKey(visualizerId, palette) : "";
  const [src, setSrc] = useState<string | null>(() =>
    cacheKey ? (cache.get(cacheKey) ?? null) : null,
  );

  useEffect(() => {
    if (!visualizerId) {
      setSrc(null);
      return;
    }

    let cancelled = false;
    const cached = cache.get(cacheKey);
    if (cached) {
      setSrc(cached);
      return;
    }

    setSrc(null);
    void requestVizCardSnapshot(visualizerId, getVisualizer, palette).then(
      (result) => {
        if (cancelled) return;
        setSrc(result.src);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [visualizerId, cacheKey, getVisualizer, palette]);

  return src;
}
