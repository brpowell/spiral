import { resolveIconId } from "@/lib/iconLibrary";

/** Music-flavoured icons a genre's watermark is picked from. */
const GENRE_ICON_IDS = [
  "note",
  "notes",
  "guitar",
  "headphones",
  "boombox",
  "microphone",
  "disc",
  "disc2",
  "cassette",
  "audioWaveform",
  "fileMusic",
  "visualizer",
  "albums",
];

/** FNV-1a: a small, stable string hash. */
function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The icon a genre shows when it has no album artwork: picked from its key, so
 * the same genre always gets the same one.
 */
export function defaultIconForGenre(key: string): string {
  return resolveIconId(GENRE_ICON_IDS[hashKey(key) % GENRE_ICON_IDS.length]);
}
