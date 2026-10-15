import type { PlaybackSource } from "./types";
import { FILE_PCM_READ_AHEAD_SECONDS } from "./pcmStreamConstants";

/**
 * Seconds of *audible* remaining before EOS to start loading the next track.
 * Decode leads the playhead by ~FILE_PCM_READ_AHEAD_SECONDS, so headroom must
 * exceed that cushion or preload starts only after the decoder is already done
 * (gapless then falls back to a forced start and leaves a pause).
 */
export const GAPLESS_PRELOAD_HEADROOM_SECONDS = FILE_PCM_READ_AHEAD_SECONDS + 2;

/**
 * Whether dual-deck PCM crossfade can run for this pair.
 * Library file ↔ file only; CD stays gapless-only (no CD↔CD fade yet).
 */
export function canCrossfade(
  outgoing: PlaybackSource,
  incoming: PlaybackSource,
): boolean {
  return outgoing.kind === "file" && incoming.kind === "file";
}

/**
 * Whether dual-deck instant (gapless) handoff can run for this pair.
 * Same-medium only: library↔library, or CD↔CD on the same drive.
 */
export function canGapless(
  outgoing: PlaybackSource,
  incoming: PlaybackSource,
): boolean {
  if (outgoing.kind === "file" && incoming.kind === "file") {
    return true;
  }
  if (outgoing.kind === "cd" && incoming.kind === "cd") {
    return outgoing.driveId === incoming.driveId;
  }
  return false;
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
