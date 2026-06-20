import type { Track } from "../types/track";

function collectUniqueTrackStrings(
  tracks: Track[],
  read: (track: Track) => string | null | undefined,
): string[] {
  const byKey = new Map<string, string>();

  for (const track of tracks) {
    const raw = read(track)?.trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, raw);
  }

  return [...byKey.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

export function collectGenreSuggestions(tracks: Track[]): string[] {
  return collectUniqueTrackStrings(tracks, (track) => track.genre);
}

export function collectAlbumSuggestions(tracks: Track[]): string[] {
  return collectUniqueTrackStrings(tracks, (track) => track.album);
}
