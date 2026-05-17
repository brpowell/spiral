import type { Track } from "../types/track";

/** Playback order: explicit queue when set, otherwise full library order. */
export function getActiveTrackIds(
  queue: number[],
  library: Track[],
): number[] {
  if (queue.length > 0) return queue;
  return library.map((t) => t.id);
}
