import type { TrackMetadataUpdate } from "@/types/metadata";
import { mbidFieldsFrom, type Track } from "@/types/track";
import { normalizeGenreName } from "./genres";

/**
 * Metadata update that sets only the genre tag, leaving every other field as
 * it is on the track (same shape the artist editor writes).
 */
export function buildTrackGenreMetadata(
  track: Track,
  genreName: string,
): TrackMetadataUpdate {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    year: track.year,
    trackNumber: track.trackNumber,
    totalTracks: track.totalTracks,
    discNumber: track.discNumber,
    totalDiscs: track.totalDiscs,
    genre: normalizeGenreName(genreName),
    artPath: track.artPath,
    artChanged: false,
    lyricsChanged: false,
    ...mbidFieldsFrom(track),
  };
}
