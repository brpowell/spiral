import {
  albumArtistKey,
  performerKeysForTrack,
  type ArtistBrowseMode,
} from "./artists";
import { albumKey } from "./albums";
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

export function isAlbumInLibrary(
  track: Track,
  albumKeys: ReadonlySet<string>,
): boolean {
  return hasNavigableAlbum(track) && albumKeys.has(albumKey(track));
}

export function isArtistInLibrary(
  track: Track,
  artistKeys: ReadonlySet<string>,
  browseMode: ArtistBrowseMode,
): boolean {
  return (
    hasNavigableArtist(track) &&
    artistKeys.has(navigationArtistKey(track, browseMode))
  );
}
