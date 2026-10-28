import { logActivity } from "./activityLog";
import { isMissingFileErrorDetail } from "./missingFileTrack";
import {
  bulkTrackMetadataSavePayload,
  tagWriteSavedPayload,
} from "./toastPayloads";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";

export function showBulkTrackMetadataSaveToast(options: {
  total: number;
  updated: number;
  errors: string[];
}): void {
  // 2+ unresolved tracks (missing or failed) route to Activity Log.
  if (options.errors.length >= 2) {
    const failedErrors = options.errors.filter(
      (line) => !isMissingFileErrorDetail(line),
    );
    const missing = options.errors.length - failedErrors.length;
    logActivity({
      level: "warn",
      domain: ACTIVITY_LOG_DOMAINS.library,
      message: "Track metadata save completed with unresolved tracks",
      details: {
        total: options.total,
        updated: options.updated,
        missing,
        failed: failedErrors.length,
        errors: options.errors,
      },
    });
  }

  const payload = bulkTrackMetadataSavePayload({
    updated: options.updated,
    errors: options.errors,
  });
  if (!payload) return;
  useBackgroundTasksStore.getState().showToast(payload);
}

/** Success toast for saves that rewrote tags in more than one file. */
export function showTagWriteSavedToast(fileCount: number): void {
  const payload = tagWriteSavedPayload(fileCount);
  if (!payload) return;
  useBackgroundTasksStore.getState().showToast(payload);
}
