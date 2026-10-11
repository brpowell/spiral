import { playlistAddedPayload } from "./toastPayloads";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import type { Playlist } from "../types/playlist";
import type { Track } from "../types/track";

export function showPlaylistAddedToast(
  trackIds: number[],
  library: Track[],
  playlist: Playlist,
): void {
  const tracks = trackIds
    .map((id) => library.find((t) => t.id === id))
    .filter((t): t is Track => t != null);
  const payload = playlistAddedPayload(tracks, playlist.title);
  if (!payload) return;
  useBackgroundTasksStore.getState().showToast(payload);
}
