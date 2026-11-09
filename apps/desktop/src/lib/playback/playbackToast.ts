import {
  playbackFileMissingPayload,
  playbackFilesMissingPayload,
} from "@/lib/toastPayloads";
import { useBackgroundTasksStore } from "@/store/useBackgroundTasksStore";
import type { Track } from "@/types/track";

export function showPlaybackFileMissingToast(
  track: Pick<Track, "title">,
): void {
  useBackgroundTasksStore
    .getState()
    .showErrorToast(playbackFileMissingPayload(track));
}

/** Skips this close together are one run, sharing one toast. */
const SKIP_RUN_MS = 2000;

let skipRun: { trackIds: Set<number>; lastSkipAt: number } | null = null;

/**
 * Tell the user a track was skipped because its file is missing. A run of
 * skips replaces one toast, which names the track until there are several.
 */
export function showMissingTrackSkippedToast(
  track: Pick<Track, "id" | "title">,
): void {
  const now = Date.now();
  if (!skipRun || now - skipRun.lastSkipAt > SKIP_RUN_MS) {
    skipRun = { trackIds: new Set(), lastSkipAt: now };
  }
  skipRun.lastSkipAt = now;
  skipRun.trackIds.add(track.id);
  const count = skipRun.trackIds.size;
  useBackgroundTasksStore
    .getState()
    .showErrorToast(
      count > 1
        ? playbackFilesMissingPayload(count)
        : playbackFileMissingPayload(track),
    );
}
