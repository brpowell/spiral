import { playbackFileMissingPayload } from "./toastPayloads";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import type { Track } from "../types/track";

export function showPlaybackFileMissingToast(
  track: Pick<Track, "title">,
): void {
  useBackgroundTasksStore
    .getState()
    .showErrorToast(playbackFileMissingPayload(track));
}
