import type { Track } from "../../types/track";
import { compareLocalized } from "../../lib/appLocale";
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
      cmp = compareLocalized(a.title, b.title);
      break;
    case "artist":
      cmp = compareLocalized(a.artist ?? "", b.artist ?? "");
      break;
    case "album":
      cmp = compareLocalized(a.album ?? "", b.album ?? "");
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
      cmp = compareLocalized(a.genre ?? "", b.genre ?? "");
      break;
    case "dateAdded":
      cmp = a.dateAdded.localeCompare(b.dateAdded);
      break;
    case "playCount":
      cmp = a.playCount - b.playCount;
      break;
    case "lastPlayedAt": {
      const aVal = a.lastPlayedAt ?? "";
      const bVal = b.lastPlayedAt ?? "";
      if (!aVal && !bVal) {
        cmp = 0;
      } else if (!aVal) {
        return 1;
      } else if (!bVal) {
        return -1;
      } else {
        cmp = aVal.localeCompare(bVal);
      }
      break;
    }
    case "rating": {
      const unratedSentinel = dir === "asc" ? Number.MAX_SAFE_INTEGER : -1;
      const ratingA = a.rating === 0 ? unratedSentinel : a.rating;
      const ratingB = b.rating === 0 ? unratedSentinel : b.rating;
      cmp = ratingA - ratingB;
      break;
    }
    case "codec":
      cmp = compareLocalized(a.codec ?? "", b.codec ?? "");
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
