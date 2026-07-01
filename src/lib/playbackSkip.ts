import { fileExists } from "./artPath";
import { isTrackImporting } from "./pendingImportTrack";
import { isTrackMissingFile } from "./missingFileTrack";
import type { RepeatMode, Track } from "../types/track";

export type PlaybackNextIdFn = (
  queue: number[],
  currentId: number,
  mode: RepeatMode,
) => number | null;

export function isTrackKnownUnplayable(track: Track | undefined): boolean {
  if (!track) return true;
  if (isTrackImporting(track)) return true;
  if (isTrackMissingFile(track)) return true;
  return false;
}

async function isTrackPlayableOnDisk(track: Track): Promise<boolean> {
  if (isTrackKnownUnplayable(track)) return false;
  return fileExists(track.filePath);
}

/** Skip tracks already flagged missing (or importing) when advancing the set list. */
export function getNextSkippingKnownUnplayable(
  order: number[],
  currentId: number,
  repeatMode: RepeatMode,
  library: Track[],
  getNextId: PlaybackNextIdFn,
): number | null {
  let candidate = getNextId(order, currentId, repeatMode);
  const visited = new Set<number>();

  while (candidate !== null) {
    if (visited.has(candidate)) return null;
    visited.add(candidate);

    const track = library.find((item) => item.id === candidate);
    if (!isTrackKnownUnplayable(track)) {
      return candidate;
    }

    candidate = getNextId(order, candidate, repeatMode);
  }

  return null;
}

export interface FindNextPlayableOptions {
  onDiscoveredMissing?: (trackId: number) => void;
}

/** Walk the set list until a track exists on disk or the list is exhausted. */
export async function findNextPlayableInOrder(
  order: number[],
  currentId: number,
  repeatMode: RepeatMode,
  library: Track[],
  getNextId: PlaybackNextIdFn,
  options: FindNextPlayableOptions = {},
): Promise<number | null> {
  let candidate = getNextId(order, currentId, repeatMode);
  const visited = new Set<number>();

  while (candidate !== null) {
    if (visited.has(candidate)) return null;
    visited.add(candidate);

    const track = library.find((item) => item.id === candidate);
    if (!track || isTrackImporting(track)) {
      candidate = getNextId(order, candidate, repeatMode);
      continue;
    }

    if (isTrackMissingFile(track)) {
      candidate = getNextId(order, candidate, repeatMode);
      continue;
    }

    if (await isTrackPlayableOnDisk(track)) {
      return candidate;
    }

    options.onDiscoveredMissing?.(candidate);
    candidate = getNextId(order, candidate, repeatMode);
  }

  return null;
}
