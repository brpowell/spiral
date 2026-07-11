import type { Track } from "../../types/track";
import { lyricsFormatSortRank } from "../../lib/lyrics";
import type { TrackListSortDir, TrackListSortField } from "./types";

export function compareTracks(
  a: Track,
  b: Track,
  field: TrackListSortField,
  dir: TrackListSortDir,
): number {
  let cmp = 0;

  switch (field) {
    case "title":
      cmp = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      break;
    case "artist":
      cmp = (a.artist ?? "").localeCompare(b.artist ?? "", undefined, {
        sensitivity: "base",
      });
      break;
    case "album":
      cmp = (a.album ?? "").localeCompare(b.album ?? "", undefined, {
        sensitivity: "base",
      });
      break;
    case "trackNumber": {
      const numA = a.trackNumber ?? Number.MAX_SAFE_INTEGER;
      const numB = b.trackNumber ?? Number.MAX_SAFE_INTEGER;
      cmp = numA - numB;
      break;
    }
    case "duration":
      cmp = (a.durationSeconds ?? 0) - (b.durationSeconds ?? 0);
      break;
    case "year":
      cmp = (a.year ?? 0) - (b.year ?? 0);
      break;
    case "genre":
      cmp = (a.genre ?? "").localeCompare(b.genre ?? "", undefined, {
        sensitivity: "base",
      });
      break;
    case "dateAdded":
      cmp = a.dateAdded.localeCompare(b.dateAdded);
      break;
    case "playCount":
      cmp = a.playCount - b.playCount;
      break;
    case "rating": {
      const unratedSentinel = dir === "asc" ? Number.MAX_SAFE_INTEGER : -1;
      const ratingA = a.rating === 0 ? unratedSentinel : a.rating;
      const ratingB = b.rating === 0 ? unratedSentinel : b.rating;
      cmp = ratingA - ratingB;
      break;
    }
    case "codec":
      cmp = (a.codec ?? "").localeCompare(b.codec ?? "", undefined, {
        sensitivity: "base",
      });
      break;
    case "sampleRate":
      cmp = (a.sampleRate ?? 0) - (b.sampleRate ?? 0);
      break;
    case "bitrate":
      cmp = (a.bitrate ?? 0) - (b.bitrate ?? 0);
      break;
    case "lyrics": {
      const noLyricsRank = dir === "asc" ? 99 : -1;
      cmp =
        lyricsFormatSortRank(a.lyricsFormat, noLyricsRank) -
        lyricsFormatSortRank(b.lyricsFormat, noLyricsRank);
      break;
    }
  }

  return dir === "asc" ? cmp : -cmp;
}

export function matchesTrackSearch(track: Track, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    track.title,
    track.artist,
    track.album,
    track.albumArtist,
    track.genre,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}
