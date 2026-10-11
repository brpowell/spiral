import { queueAddedPayload } from "./toastPayloads";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import type { Track } from "../types/track";

export function showQueueAddedToast(ids: number[], library: Track[]): void {
  const tracks = ids
    .map((id) => library.find((t) => t.id === id))
    .filter((t): t is Track => t != null);
  showQueueAddedToastForTracks(tracks);
}

export function showQueueAddedToastForTracks(tracks: Track[]): void {
  const payload = queueAddedPayload(tracks);
  if (!payload) return;
  useBackgroundTasksStore.getState().showToast(payload);
}
