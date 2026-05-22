import type { Playlist } from "../types/playlist";
import type { Track } from "../types/track";

export const RECENT_PLAYLISTS_LIMIT = 5;

export function resolvePlaylistTracks(
  playlist: Playlist,
  library: Track[],
): Track[] {
  const byId = new Map(library.map((t) => [t.id, t]));
  return playlist.trackIds
    .map((id) => byId.get(id))
    .filter((t): t is Track => t != null);
}

export function recentPlaylists(
  playlists: Playlist[],
  limit = RECENT_PLAYLISTS_LIMIT,
): Playlist[] {
  return [...playlists]
    .sort(
      (a, b) =>
        new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime(),
    )
    .slice(0, limit);
}

export function sortedPlaylists(playlists: Playlist[]): Playlist[] {
  return [...playlists].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
}

export function getPlaylistById(
  playlists: Playlist[],
  id: number,
): Playlist | undefined {
  return playlists.find((p) => p.id === id);
}
