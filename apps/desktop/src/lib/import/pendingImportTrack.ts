import { isCdTrackListId } from "@/lib/cd/cdTracks";
import {
  mbidFieldsFrom,
  type Track,
  type TrackInput,
  type TrackListId,
} from "@/types/track";

const PENDING_TRACK_ID_PREFIX = "pending:";

let nextPendingId = 1;

export function resetPendingTrackIds(): void {
  nextPendingId = 1;
}

/** A synthetic `pending:<n>` id for a track row still being imported. */
export function allocPendingTrackId(): TrackListId {
  return `${PENDING_TRACK_ID_PREFIX}${nextPendingId++}`;
}

export function isPendingTrackId(id: TrackListId): boolean {
  return id.startsWith(PENDING_TRACK_ID_PREFIX);
}

/** True for a saved library track's id: neither a pending import nor a CD row. */
export function isLibraryTrackId(id: TrackListId): boolean {
  return !isPendingTrackId(id) && !isCdTrackListId(id);
}

export function isTrackImporting(track: Track): boolean {
  return track.importStatus === "importing";
}

export function isTrackInteractive(track: Track): boolean {
  return !isTrackImporting(track);
}

/** Library tracks that can be converted (saved rows, not mid-import). */
export function isTrackConvertible(track: Track): boolean {
  return isLibraryTrackId(track.id) && isTrackInteractive(track);
}

export function pendingTrackFromInput(
  id: TrackListId,
  sourcePath: string,
  input: TrackInput,
): Track {
  return {
    id,
    title: input.title,
    artist: input.artist,
    album: input.album,
    albumArtist: input.albumArtist,
    trackNumber: input.trackNumber,
    totalTracks: input.totalTracks,
    discNumber: input.discNumber,
    totalDiscs: input.totalDiscs,
    year: input.year,
    genre: input.genre,
    durationSeconds: input.durationSeconds,
    sampleRate: input.sampleRate ?? null,
    bitrate: input.bitrate ?? null,
    codec: input.codec ?? null,
    filePath: sourcePath,
    artPath: input.artPath,
    dateAdded: new Date().toISOString(),
    playCount: 0,
    lastPlayedAt: null,
    rating: input.rating ?? 0,
    importStatus: "importing",
    importSourcePath: sourcePath,
    ...mbidFieldsFrom(input),
  };
}
