import type { Album } from "../types/album";
import type { CdDisc } from "../types/cd";
import type { Track } from "../types/track";
import { t } from "./i18n";

export function albumKey(track: Track): string {
  const album = track.album?.trim() || t("common:unknownAlbum");
  const albumArtist =
    track.albumArtist?.trim() ||
    track.artist?.trim() ||
    t("common:unknownArtist");
  return `${album}\0${albumArtist}`;
}

function compareTracks(a: Track, b: Track): number {
  const discA = a.discNumber ?? 1;
  const discB = b.discNumber ?? 1;
  if (discA !== discB) return discA - discB;

  const numA = a.trackNumber ?? Number.MAX_SAFE_INTEGER;
  const numB = b.trackNumber ?? Number.MAX_SAFE_INTEGER;
  if (numA !== numB) return numA - numB;

  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

export function pickArtPath(tracks: Track[]): string | null {
  for (const track of tracks) {
    if (track.artPath) return track.artPath;
  }
  return null;
}

function displayArtist(tracks: Track[]): string {
  const albumArtist = tracks.find((t) => t.albumArtist?.trim())?.albumArtist?.trim();
  if (albumArtist) return albumArtist;

  const artist = tracks.find((t) => t.artist?.trim())?.artist?.trim();
  return artist ?? t("common:unknownArtist");
}

export function groupTracksIntoAlbums(tracks: Track[]): Album[] {
  const groups = new Map<string, Track[]>();

  for (const track of tracks) {
    const key = albumKey(track);
    const list = groups.get(key);
    if (list) list.push(track);
    else groups.set(key, [track]);
  }

  const albums: Album[] = [];

  for (const [key, albumTracks] of groups) {
    const sorted = [...albumTracks].sort(compareTracks);
    const title = sorted[0]?.album?.trim() || t("common:unknownAlbum");
    const year =
      sorted.find((t) => t.year != null)?.year ??
      sorted.reduce<number | null>((best, t) => {
        if (t.year == null) return best;
        if (best == null) return t.year;
        return Math.max(best, t.year);
      }, null);

    albums.push({
      key,
      title,
      artist: displayArtist(sorted),
      year,
      artPath: pickArtPath(sorted),
      tracks: sorted,
    });
  }

  return albums.sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
}

export function albumTotalDurationSeconds(tracks: Track[]): number {
  return tracks.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
}

interface AlbumDiscGroup {
  discNumber: number;
  tracks: Track[];
}

/** Split album tracks into disc groups, preserving track order within each disc. */
export function groupAlbumTracksByDisc(tracks: Track[]): AlbumDiscGroup[] {
  const groups = new Map<number, Track[]>();

  for (const track of tracks) {
    const discNumber = track.discNumber ?? 1;
    const list = groups.get(discNumber);
    if (list) list.push(track);
    else groups.set(discNumber, [track]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([discNumber, discTracks]) => ({ discNumber, tracks: discTracks }));
}

export function getAlbumByKey(albums: Album[], key: string): Album | undefined {
  return albums.find((a) => a.key === key);
}

function titlesEqual(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

function discArtistForMatch(disc: CdDisc): string | null {
  const fromDisc = disc.artist?.trim();
  if (fromDisc) return fromDisc;
  for (const track of disc.tracks) {
    const artist = track.artist?.trim();
    if (artist) return artist;
  }
  return null;
}

function syntheticDiscTrack(disc: CdDisc): Track {
  const first = disc.tracks[0];
  return {
    id: 0,
    title: "",
    artist: first?.artist ?? disc.artist ?? null,
    album: disc.album ?? null,
    albumArtist: disc.artist ?? null,
    trackNumber: null,
    totalTracks: null,
    discNumber: null,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: null,
    filePath: "",
    artPath: null,
    dateAdded: "",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
  };
}

function albumArtistsMatch(album: Album, discArtist: string | null): boolean {
  if (discArtist == null) {
    return album.artist === t("common:unknownArtist");
  }
  return titlesEqual(album.artist, discArtist);
}

function albumSharesDiscTrack(album: Album, disc: CdDisc): boolean {
  const discByNumber = new Map(
    disc.tracks.map((track) => [track.number, track.title?.trim() ?? ""]),
  );
  for (const track of album.tracks) {
    if (track.trackNumber == null) continue;
    const discTitle = discByNumber.get(track.trackNumber);
    if (discTitle == null) continue;
    if (titlesEqual(track.title, discTitle)) return true;
  }
  return false;
}

/** Match a loaded disc to an existing library album for metadata reuse on import. */
export function findMatchingLibraryAlbum(
  albums: Album[],
  disc: CdDisc,
): Album | undefined {
  if (albums.length === 0) return undefined;

  const key = albumKey(syntheticDiscTrack(disc));
  const exact = albums.find((album) => album.key === key);
  if (exact) return exact;

  const discAlbum = disc.album?.trim() || t("common:unknownAlbum");
  const discArtist = discArtistForMatch(disc);

  return albums.find((album) => {
    if (!titlesEqual(album.title, discAlbum)) return false;
    if (albumArtistsMatch(album, discArtist)) return true;
    return albumSharesDiscTrack(album, disc);
  });
}

export interface AlbumImportMetadata {
  album: string;
  albumArtist: string | null;
  defaultTrackArtist: string | null;
  year: number | null;
  genre: string | null;
  artPath: string | null;
}

/** Canonical album fields from library tracks so imports group with the existing album. */
export function albumImportMetadata(album: Album): AlbumImportMetadata {
  const rep =
    album.tracks.find((track) => track.albumArtist?.trim()) ??
    album.tracks.find((track) => track.artist?.trim()) ??
    album.tracks[0];

  return {
    album: rep?.album?.trim() || album.title,
    albumArtist: rep?.albumArtist?.trim() ?? null,
    defaultTrackArtist: rep?.artist?.trim() ?? null,
    year: album.year,
    genre: album.tracks.find((track) => track.genre?.trim())?.genre?.trim() ?? null,
    artPath: album.artPath,
  };
}
