import {
  normalizeArtistName,
  parseArtistField,
} from "./artistNames";
import type { Track } from "../types/track";

export function collectArtistNameSuggestions(tracks: Track[]): string[] {
  const byKey = new Map<string, string>();

  for (const track of tracks) {
    for (const raw of [track.artist, track.albumArtist]) {
      if (!raw?.trim()) continue;
      for (const name of parseArtistField(raw)) {
        const key = normalizeArtistName(name);
        if (!byKey.has(key)) byKey.set(key, name);
      }
    }
  }

  return [...byKey.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}
