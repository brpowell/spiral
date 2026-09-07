import type { Playlist, PlaylistImageMode } from "../types/playlist";
import type { Track } from "../types/track";
import { albumKey } from "./albums";

/** Stable cache key for playlist cover art in Artwork/playlists/. */
export function playlistArtCacheKey(
  playlistId: number,
  title?: string,
): string {
  const safe = (title ?? "playlist").trim() || "playlist";
  return `playlist:${playlistId}:${safe}`;
}

/**
 * Art paths for generated playlist mosaics: one tile per unique album
 * (playlist order), up to `limit`. Same-album tracks share one tile even when
 * their cached `artPath` values differ.
 */
export function uniqueAlbumArtPaths(tracks: Track[], limit = 4): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const track of tracks) {
    if (!track.artPath) continue;
    const key = albumKey(track);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(track.artPath);
    if (paths.length >= limit) break;
  }
  return paths;
}

/** Deterministic accent colors for empty or art-less playlists. */
export function playlistGradientStyle(
  playlistId: number,
  title: string,
): { background: string } {
  let hash = playlistId;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  const hue1 = Math.abs(hash % 360);
  const hue2 = (hue1 + 40 + Math.abs((hash >> 8) % 80)) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue1} 45% 42%), hsl(${hue2} 50% 32%))`,
  };
}

export function playlistUsesCustomImage(playlist: Playlist): boolean {
  return playlist.imageMode === "custom" && playlist.customImagePath != null;
}

export function resolvePlaylistImageMode(
  mode: PlaylistImageMode,
  customImagePath: string | null,
): PlaylistImageMode {
  if (mode === "custom" && !customImagePath) return "generated";
  return mode;
}
