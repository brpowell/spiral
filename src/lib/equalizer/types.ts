export const EQ_BAND_COUNT = 10;

export const EQ_GAIN_MIN = -14;
export const EQ_GAIN_MAX = 14;

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
}

export interface EqualizerPreset {
  id: string;
  name: string;
  bands: EqualizerBandGains;
  builtin: boolean;
}

export type EqualizerStateSnapshot = EqualizerState;

export type EqualizerRemoteAction =
  | { type: "setBand"; band: number; gain: number }
  | { type: "applyPreset"; presetId: string }
  | { type: "reset" }
  | { type: "setEnabled"; enabled: boolean };

export const FLAT_BAND_GAINS: EqualizerBandGains = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

export function clampBandGain(gainDb: number): number {
  const rounded = Math.round(gainDb);
  return Math.min(EQ_GAIN_MAX, Math.max(EQ_GAIN_MIN, rounded));
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

/** Map −14…+14 dB to slider ratio 0…1 (bottom = cut, top = boost). */
export function gainDbToRatio(gainDb: number): number {
  return clamp01((clampBandGain(gainDb) - EQ_GAIN_MIN) / EQ_GAIN_SPAN);
}

/** Map slider ratio 0…1 to nearest integer dB step in −14…+14. */
export function ratioToGainDb(ratio: number): number {
  return clampBandGain(EQ_GAIN_MIN + clamp01(ratio) * EQ_GAIN_SPAN);
}

export function formatEqBandFrequency(hz: number): string {
  return hz >= 1_000 ? `${hz / 1_000}k` : String(hz);
}
