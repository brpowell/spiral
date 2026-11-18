import { fileExists } from "@/lib/art/artPath";
import { getUnavailableSourceIds } from "@/lib/tauri";
import { isCdTrackListId } from "@/lib/cd/cdTracks";
import { isTrackImporting } from "@/lib/import/pendingImportTrack";
import { isTrackMissingFile } from "@/lib/tracks/missingFileTrack";
import type { RepeatMode, Track } from "@/types/track";

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

/** Library lookup for set-list and skip logic; CD list ids are always playable. */
export function isPlaybackIdKnownUnplayable(
  id: number,
  library: Track[],
): boolean {
  if (isCdTrackListId(id)) return false;
  const track = library.find((item) => item.id === id);
  return isTrackKnownUnplayable(track);
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
  onSkipped?: (trackId: number) => void,
): number | null {
  let candidate = getNextId(order, currentId, repeatMode);
  const visited = new Set<number>();

  while (candidate !== null) {
    if (visited.has(candidate)) return null;
    visited.add(candidate);

    if (!isPlaybackIdKnownUnplayable(candidate, library)) {
      return candidate;
    }

    onSkipped?.(candidate);
    candidate = getNextId(order, candidate, repeatMode);
  }

  return null;
}

/**
 * The sources whose folder isn't answering. A failed check reads as "none", so
 * playback falls back to looking at each file.
 */
export async function unavailableSourceIds(): Promise<Set<number>> {
  try {
    return new Set(await getUnavailableSourceIds());
  } catch (err) {
    console.error("getUnavailableSourceIds failed:", err);
    return new Set();
  }
}

export interface FindNextPlayableOptions {
  /** A track already flagged missing was passed over. */
  onSkippedMissing?: (trackId: number) => void;
  onDiscoveredMissing?: (trackId: number) => void;
  /**
   * A track's source folder isn't answering (an unplugged drive, a dropped
   * share). Called once per source, with the track the walk reached; the
   * caller flags all of the source's tracks. Its other tracks are then passed
   * over without looking at their files.
   */
  onSourceUnavailable?: (sourceId: number, trackId: number) => void;
}

/**
 * Walk the set list until a track exists on disk or the list is exhausted. A
 * track's source folder is checked before its file: if the folder isn't
 * accessible, every track in it is passed over at once rather than tried one
 * by one (each of which could wait on a dead network share).
 */
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
  /** Looked up when the first track with a source needs it. */
  let unavailable: Set<number> | null = null;
  const offlineReported = new Set<number>();

  while (candidate !== null) {
    if (visited.has(candidate)) return null;
    visited.add(candidate);

    if (isCdTrackListId(candidate)) {
      return candidate;
    }

    const track = library.find((item) => item.id === candidate);
    if (!track || isTrackImporting(track)) {
      candidate = getNextId(order, candidate, repeatMode);
      continue;
    }

    if (isTrackMissingFile(track)) {
      options.onSkippedMissing?.(candidate);
      candidate = getNextId(order, candidate, repeatMode);
      continue;
    }

    if (track.sourceId !== undefined) {
      unavailable ??= await unavailableSourceIds();
      if (unavailable.has(track.sourceId)) {
        // The first track of an offline source tells the caller to flag the
        // source; the rest are flagged by then and are only passed over.
        if (!offlineReported.has(track.sourceId)) {
          offlineReported.add(track.sourceId);
          options.onSourceUnavailable?.(track.sourceId, candidate);
        } else {
          options.onSkippedMissing?.(candidate);
        }
        candidate = getNextId(order, candidate, repeatMode);
        continue;
      }
    }

    if (await isTrackPlayableOnDisk(track)) {
      return candidate;
    }

    options.onDiscoveredMissing?.(candidate);
    candidate = getNextId(order, candidate, repeatMode);
  }

  return null;
}
