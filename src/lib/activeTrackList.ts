import type { Track } from "../types/track";

function automaticIds(playContextIds: number[], library: Track[]): number[] {
  if (playContextIds.length > 0) return playContextIds;
  return library.map((t) => t.id);
}

/**
 * Full playback order: played/current context, then manual queue, then remaining
 * automatic tracks. Manual queue is excluded from shuffle and listed before
 * automatic continuation.
 */
export function buildPlaybackOrder(
  manualQueueIds: number[],
  playContextIds: number[],
  library: Track[],
  currentTrackId: number | null,
): number[] {
  const automatic = automaticIds(playContextIds, library);
  const manualSet = new Set(manualQueueIds);

  if (currentTrackId === null) {
    const automaticRest = automatic.filter((id) => !manualSet.has(id));
    return [...manualQueueIds, ...automaticRest];
  }

  const currentIdx = automatic.indexOf(currentTrackId);
  const beforeAndCurrent =
    currentIdx >= 0 ? automatic.slice(0, currentIdx + 1) : [currentTrackId];
  const afterAutomatic =
    currentIdx >= 0 ? automatic.slice(currentIdx + 1) : automatic;
  const manualUpcoming = manualQueueIds.filter((id) => id !== currentTrackId);
  const afterFiltered = afterAutomatic.filter((id) => !manualSet.has(id));

  return [...beforeAndCurrent, ...manualUpcoming, ...afterFiltered];
}

/** @deprecated Use buildPlaybackOrder — kept for callers passing legacy single queue. */
export function getActiveTrackIds(
  queue: number[],
  library: Track[],
): number[] {
  return buildPlaybackOrder([], queue, library, null);
}
