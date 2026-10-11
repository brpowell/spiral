export interface PlaybackSettings {
  crossfadeEnabled: boolean;
  crossfadeSeconds: number;
  crossfadeOnSkip: boolean;
  crossfadeVisualEnabled: boolean;
}

export const MIN_CROSSFADE_SECONDS = 1;
export const MAX_CROSSFADE_SECONDS = 12;
export const DEFAULT_CROSSFADE_SECONDS = 7;

export function defaultPlaybackSettings(): PlaybackSettings {
  return {
    crossfadeEnabled: false,
    crossfadeSeconds: DEFAULT_CROSSFADE_SECONDS,
    crossfadeOnSkip: false,
    crossfadeVisualEnabled: true,
  };
}

export function clampCrossfadeSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_CROSSFADE_SECONDS;
  return Math.min(MAX_CROSSFADE_SECONDS, Math.max(MIN_CROSSFADE_SECONDS, seconds));
}
