import { createOperationId, logActivity } from "./activityLog";
import { isMissingFileErrorDetail } from "./missingFileTrack";
import { bulkTrackMetadataSavePayload } from "./toastPayloads";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";

export function showBulkTrackMetadataSaveToast(options: {
  total: number;
  updated: number;
  errors: string[];
}): void {
  let operationId: string | undefined;
  // 2+ unresolved tracks (missing or failed) route to Activity Log.
  if (options.errors.length >= 2) {
    const failedErrors = options.errors.filter(
      (line) => !isMissingFileErrorDetail(line),
    );
    const missing = options.errors.length - failedErrors.length;
    operationId = createOperationId();
    logActivity({
      level: "warn",
      domain: ACTIVITY_LOG_DOMAINS.metadataSave,
      message: "Track metadata save completed with unresolved tracks",
      operationId,
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
    operationId,
  });
  if (!payload) return;
  useBackgroundTasksStore.getState().showToast(payload);
}
