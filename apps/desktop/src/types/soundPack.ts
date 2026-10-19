import type { PackZone } from "./pack";

/** Mirrors Rust `SoundPackSummary`. */
export interface SoundPackSummary {
  /** Effective id: `publisherId.sound.id`. */
  id: string;
  name: string;
  author: string;
  publisherId: string;
  description: string;
  version: string;
  isBuiltin: boolean;
  zone: PackZone;
  previewPath: string | null;
  /** Sound ids in the pack's library. */
  soundIds: string[];
  /** Cue name → sound id. */
  cues: Record<string, string>;
}

/** Cues the app plays today (mirrors Rust `KNOWN_SOUND_CUES`). */
export const SOUND_CUES = {
  transportPlay: "transportPlay",
  transportControl: "transportControl",
} as const;

export type SoundCue = (typeof SOUND_CUES)[keyof typeof SOUND_CUES];
