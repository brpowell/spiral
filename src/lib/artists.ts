import { normalizeArtistName, parseArtistField } from "./artistNames";
import { pickArtPath } from "./albums";
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
    label: "Discography",
    description: "Artists as credited on albums — full releases and collections.",
  },
  {
    value: "performers",
    label: "Performers",
    description: "Everyone credited on tracks — including compilations and one-offs.",
  },
];

const UNKNOWN_ARTIST = "Unknown Artist";

function sortTracksForArtist(a: Track, b: Track): number {
  const albumCmp = (a.album ?? "").localeCompare(b.album ?? "", undefined, {
    sensitivity: "base",
  });
  if (albumCmp !== 0) return albumCmp;
  const discA = a.discNumber ?? 1;
  const discB = b.discNumber ?? 1;
  if (discA !== discB) return discA - discB;
  const numA = a.trackNumber ?? Number.MAX_SAFE_INTEGER;
  const numB = b.trackNumber ?? Number.MAX_SAFE_INTEGER;
  if (numA !== numB) return numA - numB;
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

/** Album-artist identity (matches album grouping). */
export function albumArtistKey(track: Track): string {
  return track.albumArtist?.trim() || track.artist?.trim() || UNKNOWN_ARTIST;
}

/** Normalized performer keys for a track (may be multiple). */
export function performerKeysForTrack(track: Track): string[] {
  const fromArtist = parseArtistField(track.artist);
  if (fromArtist.length > 0) {
    return [...new Set(fromArtist.map(normalizeArtistName))];
  }
  const fallback = track.albumArtist?.trim() || track.artist?.trim();
  if (fallback) return [normalizeArtistName(fallback)];
  return [UNKNOWN_ARTIST];
}

/** @deprecated Use {@link albumArtistKey} — kept for call sites that mean discography grouping. */
export function artistKey(track: Track): string {
  return albumArtistKey(track);
}

function displayNameForAlbumArtistKey(key: string, tracks: Track[]): string {
  if (key === UNKNOWN_ARTIST) return UNKNOWN_ARTIST;
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
  if (key === UNKNOWN_ARTIST) return UNKNOWN_ARTIST;
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

  return artists.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

function groupTracksByAlbumArtist(tracks: Track[]): Artist[] {
  return buildArtistGroups(tracks, albumArtistKey, displayNameForAlbumArtistKey);
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

export function artistTotalDurationSeconds(tracks: Track[]): number {
  return tracks.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
}
