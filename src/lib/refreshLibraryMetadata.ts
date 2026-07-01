import { createOperationId, logActivity } from "./activityLog";
import { formatFailureDetail } from "./formatFailureDetail";
import { refreshLibraryMetadataFromFiles } from "./tauri";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";
import type { RefreshLibraryMetadataResult } from "./tauri";

function formatRefreshSummary(result: RefreshLibraryMetadataResult): string {
  const { updated, missing, failed } = result;
  if (failed === 0 && missing === 0) {
    return updated === 1
      ? "Updated metadata for 1 track"
      : `Updated metadata for ${updated} tracks`;
  }

  const parts: string[] = [];
  if (updated > 0) {
    parts.push(`updated ${updated}`);
  }
  if (missing > 0) {
    parts.push(`${missing} missing`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }
  return `Refresh complete (${parts.join(", ")})`;
}

export function refreshLibraryMetadata(): void {
  useBackgroundTasksStore.getState().runInBackground({
    key: "library-metadata-refresh",
    label: "Refreshing library metadata…",
    run: async (ctx) => {
      const operationId = createOperationId();

      logActivity({
        level: "info",
        domain: ACTIVITY_LOG_DOMAINS.refresh,
        message: "Starting library metadata refresh",
        operationId,
      });

      const result = await refreshLibraryMetadataFromFiles();

      await usePlayerStore.getState().loadLibrary({ preservePlayback: true });

      const summary = formatRefreshSummary(result);
      ctx.setLabel(summary);

      logActivity({
        level: result.failed > 0 ? "warn" : "info",
        domain: ACTIVITY_LOG_DOMAINS.refresh,
        message: "Library metadata refresh completed",
        operationId,
        details: {
          updated: result.updated,
          missing: result.missing,
          failed: result.failed,
          ...(result.errors.length > 0 ? { errors: result.errors } : {}),
        },
      });

      if (result.failed > 0) {
        const detail = formatFailureDetail(result.errors);
        ctx.setDetail(detail);
        throw new Error(summary);
      }

      if (result.missing > 0 && result.updated === 0) {
        ctx.setDetail(
          result.missing === 1
            ? "1 track file was missing on disk"
            : `${result.missing} track files were missing on disk`,
        );
      } else {
        ctx.clearDetail();
      }
    },
  });
}
