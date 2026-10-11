import * as audio from "./playback";
import { findPlaybackTrack } from "./playbackTrack";
import type { Track } from "../types/track";

/** Map a 0–1 seek ratio to seconds using track metadata (works without local audio). */
export function seekRatioToPositionSeconds(
  library: Track[],
  currentTrackId: number | null,
  ratio: number,
  playbackTracks: Track[] = [],
): number {
  const track = findPlaybackTrack({
    library,
    playbackTracks,
    currentTrackId,
  });
  const duration =
    track?.durationSeconds ?? audio.getDurationSeconds();
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(duration, ratio * duration));
}

/** True when a synced position matches a pending seek commit (avoids bridge race flashes). */
export function seekPositionMatchesRatio(
  library: Track[],
  currentTrackId: number | null,
  positionSeconds: number,
  ratio: number,
  toleranceSeconds = 1,
  playbackTracks: Track[] = [],
): boolean {
  const expected = seekRatioToPositionSeconds(
    library,
    currentTrackId,
    ratio,
    playbackTracks,
  );
  return Math.abs(positionSeconds - expected) <= toleranceSeconds;
}
