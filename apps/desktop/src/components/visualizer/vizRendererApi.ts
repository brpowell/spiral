/**
 * Author-facing contract for pack-shipped visualizer draw modules.
 * Canvas/webgl layers point at an `entry` JS file beside viz.json that exports `create()`.
 */

import type * as ThreeNS from "three";
import type { VisualizerContext, VizFrameTheme } from "./types";
import type { VizFrameTrack } from "./vizTrack";

export type { VizFrameTheme } from "./types";
export type { VizFrameTrack, VizFrameTrackArtist } from "./vizTrack";

export type VizRendererEngine = "canvas2d" | "webgl";

/**
 * One draw tick for a pack visualizer.
 *
 * Canvas modules receive it as `render(ctx, frame)`. WebGL modules receive it
 * as `render(frame)`. The host builds a new object every animation frame.
 */
export interface VizFrame {
  /** Analyser snapshot for this tick. */
  audio: VizFrameAudio;
  /**
   * Scene clock. It starts when the visualizer is shown and keeps running
   * while playback is paused. It is not the track's playback position.
   */
  time: VizFrameTime;
  /**
   * Slot the module draws into. Canvas 2D coordinates are CSS pixels;
   * {@link VizFrameSize.dpr} is already applied to the context transform.
   */
  size: VizFrameSize;
  /** Active app theme, reduced to a display name and CSS tokens. */
  theme: VizFrameTheme;
  /** Preferences the module may honor. The host does not apply them itself. */
  flags: VizFrameFlags;
  /**
   * Loaded track. Always present. When nothing is loaded, `id` is `null`,
   * `title` is `""`, `album` and `art` are `null`, and `artists` is empty.
   */
  trackMetadata: VizFrameTrack;
}

/**
 * Audio for this tick.
 *
 * Frequency data comes from an analyser whose fft size is 256, so
 * {@link frequencies} has 128 bins. Lengths can change if that size changes;
 * read `.length` rather than assuming 128.
 */
export interface VizFrameAudio {
  /**
   * Frequency magnitudes, one per analyser bin, each in the range 0–1.
   * Index 0 is the lowest band.
   */
  frequencies: Float32Array;
  /**
   * Time-domain samples in the range −1..1, suitable for a waveform.
   * Empty when nothing is playing and the analyser has no data.
   * While playing, if a real waveform is unavailable, this is a fallback
   * built by remapping {@link frequencies} into −1..1 — not oscilloscope samples.
   */
  waveform: Float32Array;
  /** True only while playback state is `"playing"`. */
  isPlaying: boolean;
  /** RMS of every frequency bin, in the range 0–1. */
  overallEnergy: number;
  /** RMS of the lowest 8% of {@link frequencies}, in the range 0–1. */
  bassEnergy: number;
  /** RMS of {@link frequencies} from 8% through 45%, in the range 0–1. */
  midEnergy: number;
  /** RMS of {@link frequencies} from 45% through the end, in the range 0–1. */
  trebleEnergy: number;
}

/** Clock for the running scene. Both values are milliseconds. */
export interface VizFrameTime {
  /**
   * Milliseconds since this scene was shown.
   * `0` on the first frame.
   */
  elapsedMs: number;
  /**
   * Milliseconds since the previous frame.
   * `0` on the first frame, otherwise about 16 at 60fps.
   * Capped at 64 so a stalled frame does not fling an animation forward.
   */
  deltaMs: number;
}

/**
 * Drawing size of the slot.
 *
 * For canvas 2D, call `clearRect(0, 0, width, height)` and draw in that
 * space. The host has already scaled the context by {@link dpr}, so a
 * 400×120 slot is 400 by 120 even when the backing store is larger.
 */
export interface VizFrameSize {
  /** Slot width in CSS pixels. */
  width: number;
  /** Slot height in CSS pixels. */
  height: number;
  /**
   * Device pixel ratio already applied to the canvas.
   * Do not multiply coordinates by this again. Capped at 2.5.
   */
  dpr: number;
}

/** Host preferences a draw module may choose to honor. */
export interface VizFrameFlags {
  /**
   * True when the user prefers reduced motion.
   * Frames still arrive at the normal rate. Soften or hold animation in the module.
   */
  reducedMotion: boolean;
}

/** 2d context on either a DOM canvas or an OffscreenCanvas (sandbox worker). */
export type VizCanvasContext =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface VizRendererInstance {
  render(ctx: VizCanvasContext, frame: VizFrame): void;
  dispose?(): void;
}

export interface VizRendererModule {
  create(): VizRendererInstance;
}

/** Host-injected API for webgl pack modules. */
export interface VizWebGLCreateApi {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  THREE: typeof ThreeNS;
}

export interface VizWebGLRendererInstance {
  render(frame: VizFrame): void;
  resize?(width: number, height: number, dpr: number): void;
  dispose?(): void;
}

export interface VizWebGLRendererModule {
  create(api: VizWebGLCreateApi): VizWebGLRendererInstance;
}

/** Safe relative JS entry filename inside a visualizer contribution folder. */
export function isSafeVizEntry(entry: string | undefined): entry is string {
  if (typeof entry !== "string" || entry.length === 0) return false;
  return /^[A-Za-z0-9._-]+\.js$/.test(entry);
}

function binsToWaveform(bins: readonly number[]): Float32Array {
  const out = new Float32Array(bins.length);
  for (let i = 0; i < bins.length; i++) {
    out[i] = ((bins[i] ?? 0) / 255) * 2 - 1;
  }
  return out;
}

function byteTimeDomainToWaveform(data: Uint8Array<ArrayBuffer>): Float32Array {
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
  const {
    context,
    remoteWaveform,
    timeDomainData,
    elapsedMs,
    deltaMs,
    width,
    height,
  } = args;
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
    theme: context.theme,
    flags: context.flags,
    trackMetadata: context.trackMetadata,
  };
}
