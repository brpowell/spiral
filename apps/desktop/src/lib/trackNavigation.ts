import {
  albumArtistKey,
  performerKeysForTrack,
  type ArtistBrowseMode,
} from "./artists";
import { normalizeArtistName, parseArtistField } from "./artistNames";
import { albumKey } from "./albums";
import type { Track } from "../types/track";

export interface TrackArtistLink {
  name: string;
  key: string;
  linkable: boolean;
}

function artistDisplayNames(track: Track): string[] {
  const names = parseArtistField(track.artist);
  if (names.length > 0) return names;
  const fallback = track.albumArtist?.trim() || track.artist?.trim();
  return fallback ? [fallback] : [];
}

function isKeyLinkable(
  key: string,
  linkableArtistKeys: ReadonlySet<string> | undefined,
): boolean {
  return linkableArtistKeys == null || linkableArtistKeys.has(key);
}

function performerArtistLinks(
  track: Track,
  linkableArtistKeys?: ReadonlySet<string>,
): TrackArtistLink[] {
  return artistDisplayNames(track).map((name) => {
    const key = normalizeArtistName(name);
    return {
      name,
      key,
      linkable: isKeyLinkable(key, linkableArtistKeys),
    };
  });
}

/** Per-artist links for the track list artist column. */
export function artistLinksForTrack(
  track: Track,
  linkableArtistKeys?: ReadonlySet<string>,
): TrackArtistLink[] {
  if (!hasNavigableArtist(track)) return [];

  return performerArtistLinks(track, linkableArtistKeys);
}

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

/** Artist page key when the artist exists in the library; otherwise null. */
export function linkableArtistKey(
  track: Track | undefined,
  artistKeys: ReadonlySet<string>,
  browseMode: ArtistBrowseMode,
): string | null {
  if (track == null) return null;
  if (!isArtistInLibrary(track, artistKeys, browseMode)) return null;
  return navigationArtistKey(track, browseMode);
}
