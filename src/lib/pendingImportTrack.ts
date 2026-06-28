import { isCdTrackListId } from "./cdTracks";
import type { Track, TrackInput } from "../types/track";

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
    discNumber: input.discNumber,
    year: input.year,
    genre: input.genre,
    durationSeconds: input.durationSeconds,
    filePath: sourcePath,
    artPath: input.artPath,
    dateAdded: new Date().toISOString(),
    playCount: 0,
    rating: 0,
    importStatus: "importing",
    importSourcePath: sourcePath,
  };
}
