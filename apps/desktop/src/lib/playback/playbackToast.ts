import {
  playbackFileMissingPayload,
  playbackFilesMissingPayload,
} from "@/lib/toast/toastPayloads";
import { useBackgroundTasksStore } from "@/store/useBackgroundTasksStore";
import type { Track, TrackId } from "@/types/track";

export function showPlaybackFileMissingToast(
  track: Pick<Track, "title" | "sourceOffline">,
): void {
  useBackgroundTasksStore
    .getState()
    .showErrorToast(playbackFileMissingPayload(track));
}

/** Skips this close together are one run, sharing one toast. */
const SKIP_RUN_MS = 2000;

let skipRun: {
  trackIds: Set<TrackId>;
  lastSkipAt: number;
  /** Every track skipped so far was in an offline music folder. */
  allSourceOffline: boolean;
} | null = null;

/**
 * Tell the user a track was skipped because its file is missing. A run of
 * skips replaces one toast, which names the track until there are several.
 */
export function showMissingTrackSkippedToast(
  track: Pick<Track, "id" | "title" | "sourceOffline">,
): void {
  const now = Date.now();
  if (!skipRun || now - skipRun.lastSkipAt > SKIP_RUN_MS) {
    skipRun = {
      trackIds: new Set(),
      lastSkipAt: now,
      allSourceOffline: true,
    };
  }
  skipRun.lastSkipAt = now;
  skipRun.trackIds.add(track.id);
  if (!track.sourceOffline) skipRun.allSourceOffline = false;
  const count = skipRun.trackIds.size;
  useBackgroundTasksStore.getState().showErrorToast(
    count > 1
      ? playbackFilesMissingPayload(count, {
          allSourceOffline: skipRun.allSourceOffline,
        })
      : playbackFileMissingPayload(track),
  );
}
