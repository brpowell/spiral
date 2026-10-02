import type { Playlist, PlaylistImageMode } from "../types/playlist";
import type { Track } from "../types/track";
import { albumKey } from "./albums";
import { resolveIconId } from "./iconLibrary";
import { defaultPlaylistDesignCover } from "./playlistCoverPresets";

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

export function playlistUsesDesignCover(playlist: Playlist): boolean {
  return playlist.imageMode === "design";
}

/** Normalize design fields for save/preview; fills defaults when design is active. */
export function resolvePlaylistDesignFields(
  mode: PlaylistImageMode,
  coverBackground: string | null,
  coverBackgroundEnd: string | null,
  coverIcon: string | null,
): {
  coverBackground: string | null;
  coverBackgroundEnd: string | null;
  coverIcon: string | null;
} {
  if (mode !== "design") {
    return {
      coverBackground,
      coverBackgroundEnd,
      coverIcon,
    };
  }
  const defaults = defaultPlaylistDesignCover();
  const background = coverBackground?.trim() || defaults.coverBackground;
  const end = coverBackgroundEnd?.trim() || null;
  return {
    coverBackground: background,
    coverBackgroundEnd: end,
    coverIcon: resolveIconId(coverIcon),
  };
}
