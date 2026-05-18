import type { Album } from "../types/album";
import type { Track } from "../types/track";

const UNKNOWN_ALBUM = "Unknown Album";
const UNKNOWN_ARTIST = "Unknown Artist";

export function albumKey(track: Track): string {
  const album = track.album?.trim() || UNKNOWN_ALBUM;
  const albumArtist = track.albumArtist?.trim() || track.artist?.trim() || UNKNOWN_ARTIST;
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
  return artist ?? UNKNOWN_ARTIST;
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
    const title = sorted[0]?.album?.trim() || UNKNOWN_ALBUM;
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

export function getAlbumByKey(albums: Album[], key: string): Album | undefined {
  return albums.find((a) => a.key === key);
}
