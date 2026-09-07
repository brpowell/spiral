import { isCdTrackListId } from "./cdTracks";
import { mbidFieldsFrom, type Track, type TrackInput } from "../types/track";

let nextPendingId = -1;

export function resetPendingTrackIds(): void {
  nextPendingId = -1;
}

export function allocPendingTrackId(): number {
  return nextPendingId--;
}

export function isPendingTrackId(id: number): boolean {
  return id < 0 && !isCdTrackListId(id);
}

export function isTrackImporting(track: Track): boolean {
  return track.importStatus === "importing";
}

export function isTrackInteractive(track: Track): boolean {
  return !isTrackImporting(track);
}

/** Library tracks that can be converted (saved rows, not mid-import). */
export function isTrackConvertible(track: Track): boolean {
  return track.id > 0 && isTrackInteractive(track);
}

export function pendingTrackFromInput(
  id: number,
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
