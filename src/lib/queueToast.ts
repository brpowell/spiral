import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import type { Track } from "../types/track";

export function showQueueAddedToast(ids: number[], library: Track[]): void {
  const tracks = ids
    .map((id) => library.find((t) => t.id === id))
    .filter((t): t is Track => t != null);
  if (tracks.length === 0) return;

  const showToast = useBackgroundTasksStore.getState().showToast;
  if (tracks.length === 1) {
    showToast({
      key: "queue-added",
      label: "Added to queue",
      detail: tracks[0].title,
    });
    return;
  }
  showToast({
    key: "queue-added",
    label: `${tracks.length} tracks added to queue`,
  });
}
