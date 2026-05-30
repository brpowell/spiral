import type { ArtistBrowseMode } from "./artists";
import type { Artist } from "../types/artist";

/** Stable cache key for artist cover art in the art cache. */
export function artistArtCacheKey(
  artistKey: string,
): string {
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

export function artistImagesToRecord(
  images: { artistKey: string; browseMode: string; artPath: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const image of images) {
    const mode = image.browseMode as ArtistBrowseMode;
    const existing = out[image.artistKey];
    // Prefer discography if both modes exist for same artist key.
    if (!existing || mode === "discography") {
      out[image.artistKey] = image.artPath;
    }
  }
  return out;
}
