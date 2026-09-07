import type { Artist } from "../types/artist";

/** Stable cache key for artist cover art in the Artwork tree. */
export function artistArtCacheKey(artistKey: string): string {
  return `artist:${artistKey}`;
}

export function applyArtistImages(
  artists: Artist[],
  imagesByKey: Record<string, string>,
): Artist[] {
  return artists.map((artist) => {
    const custom = imagesByKey[artist.key];
    if (!custom) return artist;
    return { ...artist, artPath: custom };
  });
}

/** True when a hydrated art path is a per-track override (not album front.jpg). */
export function isAlbumArtOverride(
  artPath: string | null | undefined,
): boolean {
  if (!artPath) return false;
  const base = artPath.split(/[/\\]/).pop() ?? "";
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  return stem.toLowerCase() !== "front";
}
