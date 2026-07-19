/**
 * Author-facing contract for pack-shipped VizRenderers.
 * Contributions live under `renderers/` and export `create()` from their entry JS.
 */

import type * as ThreeNS from "three";
import type { VisualizerContext } from "./types";

export interface VizFrameAudio {
  /** Frequency bins normalized 0–1. */
  frequencies: Float32Array;
  /** Time-domain samples normalized −1..1 (may be empty). */
  waveform: Float32Array;
  isPlaying: boolean;
  overallEnergy: number;
  bassEnergy: number;
  midEnergy: number;
  trebleEnergy: number;
}

export interface VizFrame {
  audio: VizFrameAudio;
  time: { elapsedMs: number; deltaMs: number };
  size: { width: number; height: number; dpr: number };
  colors: { palette: string[]; tokens: Record<string, string> };
  flags: { reducedMotion: boolean };
}

/** 2d context on either a DOM canvas or an OffscreenCanvas (sandbox worker). */
export type VizCanvasContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export interface VizRendererInstance {
  render(
    ctx: VizCanvasContext,
    frame: VizFrame,
    params: Record<string, unknown>,
  ): void;
  dispose?(): void;
}

export interface VizRendererModule {
  create(): VizRendererInstance;
}

/** Host-injected API for `engine: "webgl"` pack modules. */
export interface VizWebGLCreateApi {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  THREE: typeof ThreeNS;
}

export interface VizWebGLRendererInstance {
  render(frame: VizFrame, params: Record<string, unknown>): void;
  resize?(width: number, height: number, dpr: number): void;
  dispose?(): void;
}

export interface VizWebGLRendererModule {
  create(api: VizWebGLCreateApi): VizWebGLRendererInstance;
}

/** Fully-qualified renderer contribution id: `authorId.packId.renderer.id`. */
export function isRendererContributionId(
  renderer: string | undefined,
): renderer is string {
  if (typeof renderer !== "string" || renderer.length === 0) return false;
  const parts = renderer.split(".");
  return (
    parts.length === 4 &&
    parts.every((p) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p)) &&
    parts[2] === "renderer"
  );
}

function binsToWaveform(bins: readonly number[]): Float32Array {
  const out = new Float32Array(bins.length);
  for (let i = 0; i < bins.length; i++) {
    out[i] = ((bins[i] ?? 0) / 255) * 2 - 1;
  }
  return out;
}

function byteTimeDomainToWaveform(
  data: Uint8Array<ArrayBuffer>,
): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = ((data[i] ?? 128) - 128) / 128;
  }
  return out;
}

export function buildVizFrame(args: {
  context: VisualizerContext;
  remoteWaveform: number[] | null;
  timeDomainData: Uint8Array<ArrayBuffer> | null;
  elapsedMs: number;
  deltaMs: number;
  width: number;
  height: number;
}): VizFrame {
  const { context, remoteWaveform, timeDomainData, elapsedMs, deltaMs, width, height } =
    args;
  const bins = context.audio.bins;
  const frequencies = new Float32Array(bins.length);
  for (let i = 0; i < bins.length; i++) {
    frequencies[i] = (bins[i] ?? 0) / 255;
  }

  let waveform: Float32Array;
  if (remoteWaveform && remoteWaveform.length > 0) {
    waveform = Float32Array.from(remoteWaveform);
  } else if (timeDomainData && timeDomainData.length > 0) {
    waveform = byteTimeDomainToWaveform(timeDomainData);
  } else if (bins.length > 0 && context.audio.isPlaying) {
    waveform = binsToWaveform(bins);
  } else {
    waveform = new Float32Array(0);
  }

  return {
    audio: {
      frequencies,
      waveform,
      isPlaying: context.audio.isPlaying,
      overallEnergy: context.audio.overallEnergy,
      bassEnergy: context.audio.bassEnergy,
      midEnergy: context.audio.midEnergy,
      trebleEnergy: context.audio.trebleEnergy,
    },
    time: { elapsedMs, deltaMs },
    size: { width, height, dpr: context.size.dpr },
    colors: context.colors,
    flags: context.flags,
  };
}
