export const EQ_BAND_COUNT = 10;

export const EQ_GAIN_MIN = -12;
export const EQ_GAIN_MAX = 12;

export const EQ_BAND_FREQUENCIES_HZ = [
  31, 63, 125, 250, 500, 1_000, 2_000, 4_000, 8_000, 16_000,
] as const;

export type EqualizerBandGains = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type EqualizerPresetId = string;

export interface EqualizerState {
  enabled: boolean;
  presetId: EqualizerPresetId;
  bands: EqualizerBandGains;
  preampGain: number;
}

export interface EqualizerPreset {
  id: string;
  name: string;
  bands: EqualizerBandGains;
  builtin: boolean;
}

export type EqualizerStateSnapshot = EqualizerState & {
  customPresets: EqualizerPreset[];
};

export type EqualizerRemoteAction =
  | { type: "setBand"; band: number; gain: number }
  | { type: "setBands"; bands: EqualizerBandGains }
  | { type: "setPreampGain"; gain: number }
  | { type: "applyPreset"; presetId: string }
  | { type: "cyclePreset"; direction: "prev" | "next" }
  | { type: "reset" }
  | { type: "setEnabled"; enabled: boolean }
  | { type: "saveCustomPreset"; name: string }
  | { type: "renameCustomPreset"; id: string; name: string }
  | { type: "deleteCustomPreset"; id: string };

export const FLAT_BAND_GAINS: EqualizerBandGains = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/** Gain values within this distance of 0 dB snap to flat while dragging. */
export const EQ_ZERO_SNAP_THRESHOLD_DB = 1;

export function clampBandGain(gainDb: number): number {
  // Snap to 0.1 dB so the slider feels continuous while keeping clean values.
  const snapped = Math.round(gainDb * 10) / 10;
  return Math.min(EQ_GAIN_MAX, Math.max(EQ_GAIN_MIN, snapped));
}

export function clampPreampGain(gainDb: number): number {
  return clampBandGain(gainDb);
}

/** Snap slider input near center to exactly 0 dB for easier reset. */
export function snapBandGainNearZero(gainDb: number): number {
  const gain = clampBandGain(gainDb);
  if (Math.abs(gain) < EQ_ZERO_SNAP_THRESHOLD_DB) {
    return 0;
  }
  return gain;
}

export function gainDbToLinear(gainDb: number): number {
  return 10 ** (clampBandGain(gainDb) / 20);
}

export function normalizeBandGains(
  bands: readonly number[],
): EqualizerBandGains {
  const normalized = bands.slice(0, EQ_BAND_COUNT).map(clampBandGain);
  while (normalized.length < EQ_BAND_COUNT) {
    normalized.push(0);
  }
  return normalized as unknown as EqualizerBandGains;
}

const EQ_GAIN_SPAN = EQ_GAIN_MAX - EQ_GAIN_MIN;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Map −12…+12 dB to slider ratio 0…1 (bottom = cut, top = boost). */
export function gainDbToRatio(gainDb: number): number {
  return clamp01((clampBandGain(gainDb) - EQ_GAIN_MIN) / EQ_GAIN_SPAN);
}

/** Map slider ratio 0…1 back to a clamped gain in −12…+12 dB. */
export function ratioToGainDb(ratio: number): number {
  return clampBandGain(EQ_GAIN_MIN + clamp01(ratio) * EQ_GAIN_SPAN);
}

export function formatEqBandFrequency(hz: number): string {
  return hz >= 1_000 ? `${hz / 1_000}k` : String(hz);
}

/** Compact frequency label for the standalone EQ (e.g. `31`, `500`, `1K`). */
export function formatEqBandFrequencyLabel(hz: number): string {
  return hz >= 1_000 ? `${hz / 1_000}K` : String(hz);
}

/** Horizontal reference lines and left-hand dB scale ticks (−12…+12 dB, 0 dB emphasized). */
export const EQ_REFERENCE_LINES_DB = [12, 6, 0, -6, -12] as const;

/** Fixed-width style (+/-, one decimal) so slider tooltips do not resize while dragging. */
export function formatEqGainDb(gainDb: number): string {
  const gain = clampBandGain(gainDb);
  if (gain >= 0) {
    return `+${gain.toFixed(1)} dB`;
  }
  return `${gain.toFixed(1)} dB`;
}

export function formatEqScaleDb(gainDb: number): string {
  const gain = clampBandGain(gainDb);
  if (gain === 0) return "0";
  return gain > 0 ? `+${gain}` : String(gain);
}
