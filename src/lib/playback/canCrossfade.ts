import { requiresPcmPlayback } from "../supportedAudio";
import type { PlaybackSource } from "./types";

export function canHowlerCrossfade(
  outgoing: PlaybackSource,
  incoming: PlaybackSource,
): boolean {
  if (outgoing.kind === "cd" || incoming.kind === "cd") return false;
  if (outgoing.kind !== "file" || incoming.kind !== "file") return false;
  return (
    !requiresPcmPlayback(outgoing.path) && !requiresPcmPlayback(incoming.path)
  );
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
