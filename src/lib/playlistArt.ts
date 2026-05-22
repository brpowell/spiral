import type { Playlist, PlaylistImageMode } from "../types/playlist";
import type { Track } from "../types/track";

/** Stable cache key for playlist cover art in the art cache. */
export function playlistArtCacheKey(playlistId: number): string {
  return `playlist:${playlistId}`;
}

export function uniqueTrackArtPaths(tracks: Track[], limit = 4): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const track of tracks) {
    if (!track.artPath || seen.has(track.artPath)) continue;
    seen.add(track.artPath);
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
