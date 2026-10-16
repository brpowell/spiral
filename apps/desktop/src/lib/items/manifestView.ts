import { SOUND_CUES } from "../../types/soundPack";

/** Loose view over a parsed manifest; the types below only read what they show. */
export type ManifestJson = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Display form of a manifest value. */
export function formatManifestValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const COLOR_VALUE =
  /^(#[0-9a-f]{3,8}|(rgb|hsl|hwb|lab|lch|oklab|oklch|color)\()/i;

export function looksLikeColor(key: string, value: string): boolean {
  return key.startsWith("color-") || COLOR_VALUE.test(value.trim());
}

export interface ThemeTokenView {
  colors: Array<[string, string]>;
  other: Array<[string, string]>;
}

export function themeTokenView(manifest: ManifestJson): ThemeTokenView {
  const colors: Array<[string, string]> = [];
  const other: Array<[string, string]> = [];
  for (const [key, raw] of Object.entries(asRecord(manifest.tokens))) {
    const value = formatManifestValue(raw);
    (looksLikeColor(key, value) ? colors : other).push([key, value]);
  }
  return { colors, other };
}

export interface SoundEntryView {
  id: string;
  file: string;
}

export interface SoundCueView {
  cue: string;
  /** Sound the pack assigns, or null when it leaves the cue to the default pack. */
  soundId: string | null;
  /** Cue the app plays today (others are kept for newer apps and ignored). */
  known: boolean;
  /** Assigned sound exists in the pack's library. */
  valid: boolean;
}

export interface SoundPackView {
  sounds: SoundEntryView[];
  cues: SoundCueView[];
}

export function soundPackView(manifest: ManifestJson): SoundPackView {
  const soundMap = asRecord(manifest.sounds);
  const cueMap = asRecord(manifest.cues);
  const known = Object.values(SOUND_CUES) as string[];

  const sounds: SoundEntryView[] = Object.entries(soundMap).map(
    ([id, file]) => ({ id, file: formatManifestValue(file) }),
  );

  const assigned: SoundCueView[] = Object.entries(cueMap).map(
    ([cue, target]) => {
      const soundId = asString(target);
      return {
        cue,
        soundId,
        known: known.includes(cue),
        valid: soundId != null && soundId in soundMap,
      };
    },
  );
  const unassigned: SoundCueView[] = known
    .filter((cue) => !(cue in cueMap))
    .map((cue) => ({ cue, soundId: null, known: true, valid: true }));

  return { sounds, cues: [...assigned, ...unassigned] };
}
