import { logActivity } from "./activityLog";
import { t } from "./i18n";
import {
  refreshLibraryMetadataFromFiles,
  type RefreshLibraryMetadataResult,
} from "./tauri";
import { formatPeerOutcomeTitle } from "./toastPeerOutcomes";
import type { BackgroundTaskSettleAsOptions } from "../store/useBackgroundTasksStore";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";

/**
 * Library refresh toast (toast-conventions peer counters).
 * `missing` counts as unresolved with `failed` — the update was requested
 * and could not complete. 1 unresolved → inline detail; 2+ → View logs.
 */
export function libraryRefreshSettleOptions(
  result: Pick<
    RefreshLibraryMetadataResult,
    "updated" | "missing" | "failed" | "errors"
  >,
): BackgroundTaskSettleAsOptions & { label: string } {
  const { updated, missing, failed, errors } = result;
  const unresolved = missing + failed;

  const label = formatPeerOutcomeTitle(
    [
      ...(updated > 0
        ? [
            {
              text: t("toasts:libraryRefresh.updated", { count: updated }),
              anchored: true,
            },
          ]
        : []),
      ...(missing > 0
        ? [
            {
              text: t("toasts:libraryRefresh.missing", { count: missing }),
            },
          ]
        : []),
      ...(failed > 0
        ? [
            {
              text: t("toasts:libraryRefresh.failed", { count: failed }),
            },
          ]
        : []),
    ],
    {
      operation: t("toasts:libraryRefresh.operation"),
      fallback: t("toasts:libraryRefresh.finished"),
    },
  );

  const status =
    unresolved === 0 ? "success" : updated > 0 ? "warning" : "error";

  if (unresolved === 0) {
    return { status, label };
  }

  if (unresolved === 1) {
    return {
      status,
      label,
      detail: errors[0] || t("toasts:libraryRefresh.finished"),
    };
  }

  return {
    status,
    label,
    logLink: true,
  };
}

export function refreshLibraryMetadata(): void {
  useBackgroundTasksStore.getState().runInBackground({
    key: "library-metadata-refresh",
    label: t("toasts:libraryRefresh.running"),
    run: async (ctx) => {
      logActivity({
        level: "info",
        domain: ACTIVITY_LOG_DOMAINS.refresh,
        message: "Starting library metadata refresh",
      });

      const result = await refreshLibraryMetadataFromFiles();

      await usePlayerStore.getState().loadLibrary({ preservePlayback: true });

      const settle = libraryRefreshSettleOptions(result);
      ctx.setLabel(settle.label);

      logActivity({
        level: result.failed > 0 || result.missing > 0 ? "warn" : "info",
        domain: ACTIVITY_LOG_DOMAINS.refresh,
        message: "Library metadata refresh completed",
        details: {
          updated: result.updated,
          missing: result.missing,
          failed: result.failed,
          ...(result.errors.length > 0 ? { errors: result.errors } : {}),
        },
      });

      ctx.settleAs(settle);
    },
  });
}
