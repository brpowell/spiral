import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import type { Track } from "../types/track";

export function showPlaybackFileMissingToast(track: Pick<Track, "title">): void {
  useBackgroundTasksStore.getState().showErrorToast({
    key: "playback-file-missing",
    label: "File not found",
    detail: track.title,
  });
}
