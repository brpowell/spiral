import type { EqualizerBandGains, EqualizerPreset } from "./types";
import { FLAT_BAND_GAINS } from "./types";

function bands(
  ...values: [
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
  ]
): EqualizerBandGains {
  return values;
}

export const BUILTIN_PRESETS: readonly EqualizerPreset[] = [
  {
    id: "flat",
    name: "Flat",
    bands: FLAT_BAND_GAINS,
    builtin: true,
  },
  {
    id: "rock",
    name: "Rock",
    bands: bands(5, 4, -4, -5, -2, 2, 5, 6, 6, 6),
    builtin: true,
  },
  {
    id: "jazz",
    name: "Jazz",
    bands: bands(4, 3, 1, 2, -2, -2, 0, 1, 3, 4),
    builtin: true,
  },
  {
    id: "classical",
    name: "Classical",
    bands: bands(5, 4, 3, 2, -2, -2, 0, 2, 3, 4),
    builtin: true,
  },
  {
    id: "pop",
    name: "Pop",
    bands: bands(-1, 2, 4, 5, 4, 1, -1, -1, -1, -1),
    builtin: true,
  },
  {
    id: "techno",
    name: "Techno",
    bands: bands(5, 4, 0, -3, -2, 0, 5, 6, 6, 5),
    builtin: true,
  },
  {
    id: "vocal",
    name: "Vocal",
    bands: bands(-2, -3, -3, 2, 5, 5, 4, 2, 0, -2),
    builtin: true,
  },
  {
    id: "bass",
    name: "Bass",
    bands: bands(7, 6, 5, 3, 1, -2, -4, -5, -5, -5),
    builtin: true,
  },
  {
    id: "treble",
    name: "Treble",
    bands: bands(-5, -5, -5, -2, 1, 3, 5, 6, 7, 7),
    builtin: true,
  },
] as const;

const presetById = new Map(BUILTIN_PRESETS.map((preset) => [preset.id, preset]));

export function getBuiltinPreset(id: string): EqualizerPreset | undefined {
  return presetById.get(id);
}

export function resolvePreset(
  id: string,
  customPresets: readonly EqualizerPreset[],
): EqualizerPreset | undefined {
  const builtin = getBuiltinPreset(id);
  if (builtin) return builtin;
  return customPresets.find((preset) => preset.id === id);
}

export function presetLabel(
  id: string,
  customPresets: readonly EqualizerPreset[],
): string {
  if (id === "manual") return "Manual";
  return resolvePreset(id, customPresets)?.name ?? id;
}

export function isKnownPresetId(
  id: string,
  customPresets: readonly EqualizerPreset[],
): boolean {
  if (id === "manual") return true;
  return resolvePreset(id, customPresets) != null;
}

function listCycleablePresetIds(
  customPresets: readonly EqualizerPreset[],
): string[] {
  return [
    ...BUILTIN_PRESETS.map((preset) => preset.id),
    ...customPresets.map((preset) => preset.id),
  ];
}

export function cyclePresetId(
  currentId: string,
  lastPresetId: string,
  customPresets: readonly EqualizerPreset[],
  direction: "prev" | "next",
): string {
  const ids = listCycleablePresetIds(customPresets);
  if (ids.length === 0) return currentId;

  const activeId = currentId === "manual" ? lastPresetId : currentId;
  let index = ids.indexOf(activeId);
  if (index === -1) index = 0;

  const offset = direction === "next" ? 1 : -1;
  return ids[(index + offset + ids.length) % ids.length]!;
}
