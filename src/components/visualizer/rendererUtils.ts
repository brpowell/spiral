import { ensureAnalyser, getAnalyser } from "../../lib/playback";
import type { VisualizerContext } from "./types";

export const IDLE_SPEED = 0.00032;
export const IDLE_WAVE_FREQ = 180;
export const IDLE_WAVE_SPREAD = 0.22;
export const IDLE_WAVE_AMP = 0.22;
export const IDLE_WAVE_BASE = 0.1;

function bucketRms(bins: readonly number[], start: number, end: number): number {
  const startIdx = Math.max(0, Math.floor(start));
  const endIdx = Math.min(bins.length, Math.ceil(end));
  if (endIdx <= startIdx) return 0;
  let sum = 0;
  for (let i = startIdx; i < endIdx; i++) {
    const normalized = (bins[i] ?? 0) / 255;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / (endIdx - startIdx));
}

/** RMS energy buckets from frequency bins (0–1), for glow and layer drives. */
export function computeAudioEnergy(bins: readonly number[]): {
  overallEnergy: number;
  bassEnergy: number;
  midEnergy: number;
  trebleEnergy: number;
} {
  if (bins.length === 0) {
    return {
      overallEnergy: 0,
      bassEnergy: 0,
      midEnergy: 0,
      trebleEnergy: 0,
    };
  }

  const len = bins.length;
  const bassEnd = Math.max(1, Math.floor(len * 0.08));
  const midEnd = Math.max(bassEnd + 1, Math.floor(len * 0.45));

  return {
    overallEnergy: bucketRms(bins, 0, len),
    bassEnergy: bucketRms(bins, 0, bassEnd),
    midEnergy: bucketRms(bins, bassEnd, midEnd),
    trebleEnergy: bucketRms(bins, midEnd, len),
  };
}

export function lerpColor(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ] as const;
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

export function paletteColorAt(
  colors: string[],
  index: number,
  count: number,
): string {
  if (colors.length === 0) return "#888888";
  if (count <= 1) return colors[0]!;
  const t = index / (count - 1);
  const colorIndex = t * (colors.length - 1);
  const idx = Math.floor(colorIndex);
  const frac = colorIndex - idx;
  const c1 = colors[idx] ?? colors[0]!;
  const c2 = colors[Math.min(idx + 1, colors.length - 1)] ?? c1;
  return lerpColor(c1, c2, frac);
}

export function applyGlow(
  ctx: CanvasRenderingContext2D,
  glow: number,
  color: string,
): void {
  if (glow <= 0) return;
  ctx.shadowBlur = glow * 24;
  ctx.shadowColor = color;
}

export function clearGlow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
}

export function idleWaveValue(
  phase: number,
  index: number,
  count: number,
): number {
  const spread = (index / Math.max(count - 1, 1)) * IDLE_WAVE_SPREAD * count;
  return (
    (Math.sin(phase * IDLE_WAVE_FREQ + spread) + 1) * 0.5 * IDLE_WAVE_AMP +
    IDLE_WAVE_BASE
  );
}

export function shouldDrawIdle(context: VisualizerContext): boolean {
  return !context.audio.isPlaying;
}

export function sampleFrequencyData(
  localDataArrayRef: { current: Uint8Array<ArrayBuffer> | null },
  remoteBins: number[] | null,
): Uint8Array<ArrayBuffer> | number[] | null {
  if (remoteBins) return remoteBins;

  ensureAnalyser();
  const analyser = getAnalyser();
  if (!analyser) return null;

  if (!localDataArrayRef.current) {
    localDataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
  }
  const localData = localDataArrayRef.current;
  analyser.getByteFrequencyData(localData);
  return localData;
}

export function sampleTimeDomainData(
  localDataArrayRef: { current: Uint8Array<ArrayBuffer> | null },
): Uint8Array<ArrayBuffer> | null {
  ensureAnalyser();
  const analyser = getAnalyser();
  if (!analyser) return null;

  if (
    !localDataArrayRef.current ||
    localDataArrayRef.current.length !== analyser.fftSize
  ) {
    localDataArrayRef.current = new Uint8Array(analyser.fftSize);
  }
  const localData = localDataArrayRef.current;
  analyser.getByteTimeDomainData(localData);
  return localData;
}

/** Map linear index 0..count-1 to a log-scaled bin index in data. */
export function logBinIndex(
  index: number,
  count: number,
  dataLength: number,
): number {
  if (count <= 1) return 0;
  const t = index / (count - 1);
  const logT = Math.pow(t, 2.2);
  return Math.min(
    dataLength - 1,
    Math.floor(logT * (dataLength - 1)),
  );
}

/** Resample normalized waveform samples (-1..1) to a target count. */
export function resampleWaveform(
  source: readonly number[],
  sampleCount: number,
): number[] {
  const samples: number[] = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const dataIndex = Math.floor((i / sampleCount) * source.length);
    samples[i] = source[dataIndex] ?? 0;
  }
  return samples;
}

/** Build waveform samples from frequency bins when time-domain data is unavailable. */
export function binsToWaveSamples(
  bins: readonly number[],
  sampleCount: number,
): number[] {
  const samples: number[] = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / Math.max(sampleCount - 1, 1);
    const binIndex = Math.floor(t * (bins.length - 1));
    const value = bins[binIndex] ?? 0;
    samples[i] = (value / 255) * 2 - 1;
  }
  return samples;
}
