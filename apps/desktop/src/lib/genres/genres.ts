import type { Track } from "@/types/track";

export interface Genre {
  /** Lowercased, trimmed name; stable identity across casing differences. */
  key: string;
  /** Most common spelling among the tracks. */
  name: string;
  tracks: Track[];
}

/** Group tracks by genre (case-insensitive), sorted by name. Untagged tracks are skipped. */
export function groupTracksIntoGenres(tracks: Track[]): Genre[] {
  const byKey = new Map<
    string,
    { tracks: Track[]; spellings: Map<string, number> }
  >();
  for (const track of tracks) {
    const name = track.genre?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let entry = byKey.get(key);
    if (!entry) {
      entry = { tracks: [], spellings: new Map() };
      byKey.set(key, entry);
    }
    entry.tracks.push(track);
    entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1);
  }
  const genres: Genre[] = [];
  for (const [key, { tracks: genreTracks, spellings }] of byKey) {
    const [name] = [...spellings.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    genres.push({ key, name, tracks: genreTracks });
  }
  return genres.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export function getGenreByKey(genres: Genre[], key: string): Genre | undefined {
  return genres.find((genre) => genre.key === key);
}

/** The genre name as it will be written to files: trimmed, or null when blank. */
export function normalizeGenreName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed === "" ? null : trimmed;
}

/** True when saving `name` would change at least one track's genre tag. */
export function genreRenameNeeded(genre: Genre, name: string): boolean {
  const next = normalizeGenreName(name) ?? "";
  return genre.tracks.some((track) => (track.genre?.trim() ?? "") !== next);
}

/**
 * The other genre that `name` would merge this one into, if any. Matching is
 * case-insensitive, like grouping; the genre's own key never counts.
 */
export function findMergeTarget(
  genres: Genre[],
  ownKey: string,
  name: string,
): Genre | undefined {
  const key = normalizeGenreName(name)?.toLowerCase();
  if (!key || key === ownKey) return undefined;
  return getGenreByKey(genres, key);
}
