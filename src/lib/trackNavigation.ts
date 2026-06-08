import {
  albumArtistKey,
  performerKeysForTrack,
  type ArtistBrowseMode,
} from "./artists";
import type { Track } from "../types/track";

export function navigationArtistKey(
  track: Track,
  browseMode: ArtistBrowseMode,
): string {
  if (browseMode === "performers") {
    return performerKeysForTrack(track)[0] ?? albumArtistKey(track);
  }
  return albumArtistKey(track);
}

export function hasNavigableAlbum(track: Track): boolean {
  return Boolean(track.album?.trim());
}

export function hasNavigableArtist(track: Track): boolean {
  return Boolean(track.artist?.trim() || track.albumArtist?.trim());
}
