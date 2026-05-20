import type { Track } from "../../types/track";
import type { TrackListSortDir, TrackListSortField } from "./types";

export function compareTracks(
  a: Track,
  b: Track,
  field: TrackListSortField,
  dir: TrackListSortDir,
): number {
  let cmp = 0;

  switch (field) {
    case "index":
      cmp = a.id - b.id;
      break;
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
