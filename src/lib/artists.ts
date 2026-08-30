import { compareLocalized } from "./appLocale";
import { normalizeArtistName, parseArtistField } from "./artistNames";
import { t } from "./i18n";
import type { Album } from "../types/album";
import type { Artist } from "../types/artist";
import type { Track } from "../types/track";

export type ArtistBrowseMode = "discography" | "performers";

export const ARTIST_BROWSE_MODES: {
  value: ArtistBrowseMode;
  label: string;
  description: string;
}[] = [
  {
    value: "discography",
    label: t("library:artistBrowse.discography.label"),
    description: t("library:artistBrowse.discography.description"),
  },
  {
    value: "performers",
    label: t("library:artistBrowse.performers.label"),
    description: t("library:artistBrowse.performers.description"),
  },
];

function sortTracksForArtist(a: Track, b: Track): number {
  const albumCmp = compareLocalized(a.album ?? "", b.album ?? "");
  if (albumCmp !== 0) return albumCmp;
  const discA = a.discNumber ?? 1;
  const discB = b.discNumber ?? 1;
  if (discA !== discB) return discA - discB;
  const numA = a.trackNumber ?? Number.MAX_SAFE_INTEGER;
  const numB = b.trackNumber ?? Number.MAX_SAFE_INTEGER;
  if (numA !== numB) return numA - numB;
  return compareLocalized(a.title, b.title);
}

/** Album-artist identity (matches album grouping). */
export function albumArtistKey(track: Track): string {
  return (
    track.albumArtist?.trim() ||
    track.artist?.trim() ||
    t("common:unknownArtist")
  );
}

/** Normalized performer keys for a track (may be multiple). */
export function performerKeysForTrack(track: Track): string[] {
  const fromArtist = parseArtistField(track.artist);
  if (fromArtist.length > 0) {
    return [...new Set(fromArtist.map(normalizeArtistName))];
  }
  const fallback = track.albumArtist?.trim() || track.artist?.trim();
  if (fallback) return [normalizeArtistName(fallback)];
  return [t("common:unknownArtist")];
}

/** @deprecated Use {@link albumArtistKey} — kept for call sites that mean discography grouping. */
export function artistKey(track: Track): string {
  return albumArtistKey(track);
}

function displayNameForAlbumArtistKey(key: string, tracks: Track[]): string {
  const unknown = t("common:unknownArtist");
  if (key === unknown) return unknown;
  for (const track of tracks) {
    const albumArtist = track.albumArtist?.trim();
    if (albumArtist && albumArtistKey(track) === key) return albumArtist;
  }
  for (const track of tracks) {
    const artist = track.artist?.trim();
    if (artist && albumArtistKey(track) === key) return artist;
  }
  return key;
}

function displayNameForPerformerKey(key: string, tracks: Track[]): string {
  const unknown = t("common:unknownArtist");
  if (key === unknown) return unknown;
  for (const track of tracks) {
    for (const name of parseArtistField(track.artist)) {
      if (normalizeArtistName(name) === key) return name;
    }
    const fallback = track.albumArtist?.trim() || track.artist?.trim();
    if (fallback && normalizeArtistName(fallback) === key) return fallback;
  }
  return key;
}

function buildArtistGroups(
  tracks: Track[],
  keyForTrack: (track: Track) => string | string[],
  displayNameForKey: (key: string, tracks: Track[]) => string,
): Artist[] {
  const groups = new Map<string, Track[]>();

  for (const track of tracks) {
    const keys = keyForTrack(track);
    const keyList = typeof keys === "string" ? [keys] : keys;
    for (const key of keyList) {
      const list = groups.get(key);
      if (list) list.push(track);
      else groups.set(key, [track]);
    }
  }

  const artists: Artist[] = [];

  for (const [key, artistTracks] of groups) {
    const sorted = [...artistTracks].sort(sortTracksForArtist);
    artists.push({
      key,
      name: displayNameForKey(key, sorted),
      // Artist images are managed separately from album art. Do not default to
      // album artwork here; artists without an explicit image should render a
      // generic user/artist placeholder in the UI.
      artPath: null,
      tracks: sorted,
    });
  }

  return artists.sort((a, b) => compareLocalized(a.name, b.name));
}

function groupTracksByAlbumArtist(tracks: Track[]): Artist[] {
  return buildArtistGroups(
    tracks,
    albumArtistKey,
    displayNameForAlbumArtistKey,
  );
}

function groupTracksIntoPerformers(tracks: Track[]): Artist[] {
  return buildArtistGroups(
    tracks,
    performerKeysForTrack,
    displayNameForPerformerKey,
  );
}

export function groupTracksIntoArtists(
  tracks: Track[],
  mode: ArtistBrowseMode = "discography",
): Artist[] {
  return mode === "performers"
    ? groupTracksIntoPerformers(tracks)
    : groupTracksByAlbumArtist(tracks);
}

export function getArtistByKey(
  artists: Artist[],
  key: string,
): Artist | undefined {
  return artists.find((a) => a.key === key);
}

export function albumsForArtist(
  albums: Album[],
  artist: Artist,
  mode: ArtistBrowseMode,
): Album[] {
  if (mode === "discography") {
    return albums.filter((a) => a.artist === artist.name);
  }
  return albums.filter((a) =>
    a.tracks.some((t) => performerKeysForTrack(t).includes(artist.key)),
  );
}

/** Tracks on the album credited to this artist for the given browse mode. */
export function artistTrackCountOnAlbum(
  album: Album,
  artist: Artist,
  mode: ArtistBrowseMode,
): number {
  if (mode === "discography") {
    return album.artist === artist.name ? album.tracks.length : 0;
  }
  return album.tracks.filter((t) =>
    performerKeysForTrack(t).includes(artist.key),
  ).length;
}

export function artistTotalDurationSeconds(tracks: Track[]): number {
  return tracks.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
}
