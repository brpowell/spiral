import { fileExists } from "@/lib/art/artPath";
import { getUnavailableSourceIds } from "@/lib/tauri";
import { isCdTrackListId } from "@/lib/cd/cdTracks";
import { isTrackImporting } from "@/lib/import/pendingImportTrack";
import {
  isTrackMissingFile,
  isTrackOnlySourceOffline,
} from "@/lib/tracks/missingFileTrack";
import type { RepeatMode, Track } from "@/types/track";

export type PlaybackNextIdFn = (
  queue: number[],
  currentId: number,
  mode: RepeatMode,
) => number | null;

/**
 * Not worth trying: importing, or its file is missing. A track flagged only
 * because its folder was offline is worth trying, so it's tried (and its
 * folder tested again) like any other: the folder may be back.
 */
export function isTrackKnownUnplayable(track: Track | undefined): boolean {
  if (!track) return true;
  if (isTrackImporting(track)) return true;
  if (isTrackOnlySourceOffline(track)) return false;
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
 * Whether a source's folder isn't answering. Only that folder is looked at, so
 * playing a track doesn't wake every other source's disk. A failed check reads
 * as "answering", so playback falls back to looking at the file.
 */
export async function isSourceUnavailable(sourceId: number): Promise<boolean> {
  try {
    return (await getUnavailableSourceIds([sourceId])).includes(sourceId);
  } catch (err) {
    console.error("getUnavailableSourceIds failed:", err);
    return false;
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
  /**
   * A track flagged offline is in a folder that answers again. Called once
   * per source; the caller clears the offline flag from all of its tracks.
   */
  onSourceAvailable?: (sourceId: number) => void;
  /** Sources known offline already (just found so): not tested again. */
  offlineSourceIds?: number[];
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
  /** Each source's folder, looked at when the walk first reaches it. */
  const unavailable = new Map<number, boolean>(
    (options.offlineSourceIds ?? []).map((id) => [id, true]),
  );
  const offlineReported = new Set<number>();
  const recovered = new Set<number>();

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

    // A file known missing is passed over; one flagged only because its
    // folder was offline gets its folder tested again below.
    if (isTrackMissingFile(track) && !isTrackOnlySourceOffline(track)) {
      options.onSkippedMissing?.(candidate);
      candidate = getNextId(order, candidate, repeatMode);
      continue;
    }

    if (track.sourceId !== undefined) {
      let offline = unavailable.get(track.sourceId);
      if (offline === undefined) {
        offline = await isSourceUnavailable(track.sourceId);
        unavailable.set(track.sourceId, offline);
      }
      if (offline) {
        // The first track of an offline source not yet flagged tells the
        // caller to flag the source; the rest are flagged by then and are
        // only passed over.
        if (!track.sourceOffline && !offlineReported.has(track.sourceId)) {
          offlineReported.add(track.sourceId);
          options.onSourceUnavailable?.(track.sourceId, candidate);
        } else {
          offlineReported.add(track.sourceId);
          options.onSkippedMissing?.(candidate);
        }
        candidate = getNextId(order, candidate, repeatMode);
        continue;
      }
      if (track.sourceOffline && !recovered.has(track.sourceId)) {
        recovered.add(track.sourceId);
        options.onSourceAvailable?.(track.sourceId);
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
