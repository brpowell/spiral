import type { Track } from "../../types/track";
import { compareLocalized } from "../../lib/appLocale";
import { createFuzzyMatcher } from "../../lib/fuzzySearch";
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

/** Title matches outrank artist/album/album-artist matches, which are tied. */
const trackSearch = createFuzzyMatcher<Track>((t) => [
  { fields: [t.title], weight: 1 },
  { fields: [t.artist, t.album, t.albumArtist], weight: 0.75 },
]);

export function matchesTrackSearch(track: Track, query: string): boolean {
  return trackSearch.matches(track, query);
}

/** Tracks matching `query` (fuzzy), original order preserved. */
export function filterTracksBySearch(tracks: Track[], query: string): Track[] {
  return trackSearch.filter(tracks, query);
}

/** Tracks matching `query` with relevance scores (original order preserved). */
export function scoreTracksBySearch(
  tracks: Track[],
  query: string,
): { item: Track; score: number }[] {
  return trackSearch.scored(tracks, query);
}

export type SortState = {
  field: TrackListSortField;
  dir: TrackListSortDir;
} | null;

/** Header click cycle: asc -> desc -> unsorted; a different column starts at asc. */
export function nextSort(
  current: SortState,
  field: TrackListSortField,
): SortState {
  if (!current || current.field !== field) return { field, dir: "asc" };
  return current.dir === "asc" ? { field, dir: "desc" } : null;
}
