import type { Track, TrackInput } from "../types/track";

export type ImportDedupeAction = "skip" | "replace" | "import";

export interface ImportDedupeResolution {
  action: ImportDedupeAction;
  /**
   * When `action` is `"replace"` and the prompt had a lyrics conflict:
   * `true` overwrites library lyrics with incoming; `false` keeps library lyrics.
   * Omitted when there is no conflict (incoming lyrics pass through as today).
   */
  replaceLyrics?: boolean;
}

export interface ImportDuplicateContext {
  incoming: TrackInput;
  existing: Track;
  pendingId: number;
  sourcePath: string;
  /** Duplicates still ahead in this import batch (excluding the current one). */
  remainingDuplicates: number;
  /** Incoming audio is not on disk yet (e.g. CD rip pending). */
  incomingPendingRip?: boolean;
  /** Both sides have non-empty lyrics and content differs. */
  hasLyricsConflict: boolean;
}

const UNKNOWN_ALBUM = "Unknown Album";
const UNKNOWN_ARTIST = "Unknown Artist";

const DURATION_TOLERANCE_SECONDS = 2;

interface TrackDedupeFields {
  albumArtist: string;
  album: string;
  discNumber: number;
  trackNumber: number | null;
  title: string;
  durationSeconds: number | null;
}

function normalizeText(value: string): string {
  return value.trim();
}

function textsEqual(a: string, b: string): boolean {
  return (
    a.localeCompare(b, undefined, { sensitivity: "base" }) === 0
  );
}

function trackDedupeFields(
  track: TrackInput | Track,
): TrackDedupeFields {
  return {
    albumArtist:
      track.albumArtist?.trim() ||
      track.artist?.trim() ||
      UNKNOWN_ARTIST,
    album: track.album?.trim() || UNKNOWN_ALBUM,
    discNumber: track.discNumber ?? 1,
    trackNumber: track.trackNumber,
    title: normalizeText(track.title),
    durationSeconds: track.durationSeconds,
  };
}

function durationsCompatible(
  a: number | null,
  b: number | null,
): boolean {
  if (a == null || b == null) return true;
  return Math.abs(a - b) <= DURATION_TOLERANCE_SECONDS;
}

export function tracksAreMetadataDuplicates(
  incoming: TrackInput | Track,
  existing: TrackInput | Track,
): boolean {
  const a = trackDedupeFields(incoming);
  const b = trackDedupeFields(existing);

  if (!textsEqual(a.albumArtist, b.albumArtist)) return false;
  if (!textsEqual(a.album, b.album)) return false;
  if (a.discNumber !== b.discNumber) return false;
  if (!textsEqual(a.title, b.title)) return false;

  if (a.trackNumber != null && b.trackNumber != null) {
    if (a.trackNumber !== b.trackNumber) return false;
  }

  return durationsCompatible(a.durationSeconds, b.durationSeconds);
}

export interface FindLibraryDuplicateOptions {
  /** Exclude tracks at this path (reference re-import edge case). */
  excludeSourcePath?: string;
}

export function findLibraryDuplicate(
  incoming: TrackInput,
  library: Track[],
  options: FindLibraryDuplicateOptions = {},
): Track | undefined {
  const excludePath = options.excludeSourcePath;

  for (const track of library) {
    if (track.id <= 0) continue;
    if (excludePath != null && track.filePath === excludePath) continue;
    if (tracksAreMetadataDuplicates(incoming, track)) {
      return track;
    }
  }

  return undefined;
}

function syntheticLibraryTrack(
  metadata: TrackInput,
  sourcePath: string,
  syntheticId: number,
): Track {
  return {
    id: syntheticId,
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    albumArtist: metadata.albumArtist,
    trackNumber: metadata.trackNumber,
    totalTracks: metadata.totalTracks,
    discNumber: metadata.discNumber,
    totalDiscs: metadata.totalDiscs,
    year: metadata.year,
    genre: metadata.genre,
    durationSeconds: metadata.durationSeconds,
    filePath: sourcePath,
    artPath: metadata.artPath,
    dateAdded: "",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
  };
}

/** Count duplicate conflicts in entries after `fromIndex`, simulating non-dupes as imported. */
export function countRemainingBatchDuplicates(
  entries: ReadonlyArray<{ sourcePath: string; metadata: TrackInput }>,
  fromIndex: number,
  library: Track[],
): number {
  let simulatedLibrary = library.filter((track) => track.id > 0);
  let remaining = 0;

  for (let j = fromIndex + 1; j < entries.length; j++) {
    const { metadata, sourcePath } = entries[j];
    if (
      findLibraryDuplicate(metadata, simulatedLibrary, {
        excludeSourcePath: sourcePath,
      })
    ) {
      remaining++;
    } else {
      simulatedLibrary = [
        ...simulatedLibrary,
        syntheticLibraryTrack(metadata, sourcePath, j + 1),
      ];
    }
  }

  return remaining;
}
