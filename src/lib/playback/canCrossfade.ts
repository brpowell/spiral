import type { PlaybackSource } from "./types";

/**
 * Whether dual-deck PCM crossfade can run for this pair.
 * Library file ↔ file only; CD stays hard-cut (separate singleton session).
 */
export function canCrossfade(
  outgoing: PlaybackSource,
  incoming: PlaybackSource,
): boolean {
  return outgoing.kind === "file" && incoming.kind === "file";
}

export function effectiveFadeSeconds(
  outgoingDuration: number,
  crossfadeSeconds: number,
): number {
  if (!Number.isFinite(outgoingDuration) || outgoingDuration <= 0) {
    return crossfadeSeconds;
  }
  return Math.min(crossfadeSeconds, outgoingDuration / 2);
}
