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
  if (tracks.length === 0) return;

  const showToast = useBackgroundTasksStore.getState().showToast;
  if (tracks.length === 1) {
    showToast({
      key: "playlist-added",
      label: `Added to ${playlist.title}`,
      detail: tracks[0].title,
    });
    return;
  }
  showToast({
    key: "playlist-added",
    label: `${tracks.length} tracks added to ${playlist.title}`,
  });
}
