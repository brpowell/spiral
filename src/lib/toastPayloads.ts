import { t } from "./i18n";
import { isMissingFileErrorDetail } from "./missingFileTrack";
import { lyricsAmbiguousSettleOptions } from "./lyricsFetchToastSettle";
import { formatPeerOutcomeTitle } from "./toastPeerOutcomes";
import type { ActivityLogRevealTarget } from "./activityLogsWindow";
import type {
  BackgroundTaskAction,
  ShowToastOptions,
} from "../store/useBackgroundTasksStore";

/** Shared toast option shape for production helpers and Toast Lab presets. */
export type ToastPayload = ShowToastOptions;

function withOptionalDismiss(
  payload: ToastPayload,
  dismissMs?: number | null,
): ToastPayload {
  if (dismissMs === undefined) return payload;
  return { ...payload, dismissMs };
}

function labelFromError(err: unknown, fallbackKey: string): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message.trim()) return err.message;
  return t(fallbackKey);
}

// —— Queue ——

export function queueAddedPayload(
  tracks: Array<{ title: string }>,
  options?: { dismissMs?: number | null },
): ToastPayload | null {
  if (tracks.length === 0) return null;
  const count = tracks.length;
  return withOptionalDismiss(
    {
      key: "queue-added",
      label: t("toasts:queue.added", { count }),
      ...(count === 1 ? { detail: tracks[0].title } : {}),
    },
    options?.dismissMs,
  );
}

// —— Playlist ——

export function playlistAddedPayload(
  tracks: Array<{ title: string }>,
  playlistTitle: string,
  options?: { dismissMs?: number | null },
): ToastPayload | null {
  if (tracks.length === 0) return null;
  const count = tracks.length;
  return withOptionalDismiss(
    {
      key: "playlist-added",
      label: t("toasts:playlist.added", {
        count,
        playlist: playlistTitle,
      }),
      ...(count === 1 ? { detail: tracks[0].title } : {}),
    },
    options?.dismissMs,
  );
}

// —— Playback ——

export function playbackFileMissingPayload(
  track: { title: string },
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "playback-file-missing",
      label: t("toasts:playback.fileMissing"),
      detail: track.title,
    },
    options?.dismissMs,
  );
}

export function cdPlaybackFailurePayload(
  kind: "disconnected" | "no_disc" | "generic",
  message: string,
  options?: {
    dismissMs?: number | null;
    /** Only for generic/unhandled failures — known kinds stay toast-only. */
    logLink?: ActivityLogRevealTarget;
  },
): ToastPayload {
  const label =
    kind === "disconnected"
      ? t("playback:cd.disconnected.label")
      : t("playback:cd.playbackFailed.label");
  const detail =
    kind === "disconnected"
      ? t("playback:cd.disconnected.detail")
      : kind === "no_disc"
        ? t("playback:cd.noDisc.detail")
        : message;

  return withOptionalDismiss(
    {
      key: "cd-playback-error",
      label,
      detail,
      ...(kind === "generic" && options?.logLink
        ? { logLink: options.logLink }
        : {}),
    },
    options?.dismissMs,
  );
}

// —— Track metadata ——

/**
 * Bulk metadata-save toast (toast-conventions peer counters).
 * `missing` counts as unresolved with `failed` — the update was requested
 * and could not complete. 1 unresolved → inline detail; 2+ → View logs.
 */
export function bulkTrackMetadataSavePayload(options: {
  updated: number;
  errors: string[];
  operationId?: string;
  dismissMs?: number | null;
}): ToastPayload | null {
  const { updated, errors, operationId, dismissMs } = options;
  if (errors.length === 0) return null;

  const missingErrors = errors.filter(isMissingFileErrorDetail);
  const failedErrors = errors.filter((line) => !isMissingFileErrorDetail(line));
  const missing = missingErrors.length;
  const failed = failedErrors.length;
  const unresolved = missing + failed;

  const label = formatPeerOutcomeTitle(
    [
      ...(updated > 0
        ? [
            {
              text: t("toasts:trackMetadata.updated", { count: updated }),
              anchored: true,
            },
          ]
        : []),
      ...(missing > 0
        ? [
            {
              text: t("toasts:trackMetadata.missing", { count: missing }),
            },
          ]
        : []),
      ...(failed > 0
        ? [
            {
              text: t("toasts:trackMetadata.failed", { count: failed }),
            },
          ]
        : []),
    ],
    {
      operation: t("toasts:trackMetadata.operation"),
      fallback: t("toasts:trackMetadata.saveFailed"),
    },
  );

  const status = updated > 0 ? "warning" : "error";

  if (unresolved === 1) {
    return withOptionalDismiss(
      {
        key: "track-metadata-save",
        label,
        status,
        detail:
          missingErrors[0] ??
          failedErrors[0] ??
          t("toasts:trackMetadata.saveFailed"),
      },
      dismissMs,
    );
  }

  return withOptionalDismiss(
    {
      key: "track-metadata-save",
      label,
      status,
      ...(operationId ? { logLink: { operationId } } : {}),
    },
    dismissMs,
  );
}

// —— Activity / diagnostics ——

export function activityLogCopiedPayload(
  count: number,
  options?: { dismissMs?: number | null },
): ToastPayload | null {
  if (count <= 0) return null;
  return withOptionalDismiss(
    {
      key: "activity-log-copied",
      label: t("toasts:activityLog.copied", { count }),
    },
    options?.dismissMs,
  );
}

export function diagnosticsCopiedPayload(options?: {
  dismissMs?: number | null;
}): ToastPayload {
  return withOptionalDismiss(
    {
      key: "diagnostics-export-copied",
      label: t("toasts:diagnostics.copied"),
    },
    options?.dismissMs,
  );
}

export function diagnosticsSavedPayload(
  fileName: string,
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "diagnostics-export-saved",
      label: t("toasts:diagnostics.exported", { fileName }),
    },
    options?.dismissMs,
  );
}

// —— Spiral Card ——

export function spiralCardInstallSuccessPayload(
  replaced: boolean,
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "spiral-card-install",
      label: replaced
        ? t("toasts:spiralCard.replaced")
        : t("toasts:spiralCard.installed"),
    },
    options?.dismissMs,
  );
}

export function spiralCardInstallErrorPayload(
  err?: unknown,
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "spiral-card-install",
      label: labelFromError(err, "toasts:spiralCard.installFailed"),
    },
    options?.dismissMs,
  );
}

export function spiralCardFinalizedPayload(options?: {
  dismissMs?: number | null;
}): ToastPayload {
  return withOptionalDismiss(
    {
      key: "spiral-card-finalize",
      label: t("toasts:spiralCard.finalized"),
      detail: t("toasts:spiralCard.finalizedDetail"),
    },
    options?.dismissMs,
  );
}

export function spiralCardFinalizeNetworkErrorPayload(
  offline: boolean,
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "spiral-card-finalize",
      label: t("toasts:spiralCard.finalizeFailed"),
      detail: offline
        ? t("toasts:spiralCard.finalizeOffline")
        : t("toasts:spiralCard.finalizeConnection"),
    },
    options?.dismissMs,
  );
}

export type SpiralCardWrapErrorKind = "too_large" | "undecodable" | "generic";

export function classifySpiralCardWrapError(
  raw: string,
): SpiralCardWrapErrorKind {
  const msg = raw.replace(/^invalid_wrap:\s*/i, "").trim();
  if (/exceeds .+ bytes|too large/i.test(msg)) return "too_large";
  if (/could not decode|not valid Base64|zero dimensions/i.test(msg)) {
    return "undecodable";
  }
  return "generic";
}

export function spiralCardWrapErrorPayload(
  kind: SpiralCardWrapErrorKind,
  options?: { dismissMs?: number | null },
): ToastPayload {
  if (kind === "too_large") {
    return withOptionalDismiss(
      {
        key: "spiral-card-wrap",
        label: t("toasts:spiralCard.wrapTooLarge"),
        detail: t("toasts:spiralCard.wrapTooLargeDetail"),
      },
      options?.dismissMs,
    );
  }
  if (kind === "undecodable") {
    return withOptionalDismiss(
      {
        key: "spiral-card-wrap",
        label: t("toasts:spiralCard.wrapUndecodable"),
        detail: t("toasts:spiralCard.wrapUndecodableDetail"),
      },
      options?.dismissMs,
    );
  }
  return withOptionalDismiss(
    {
      key: "spiral-card-wrap",
      label: t("toasts:spiralCard.wrapFailed"),
      detail: t("toasts:spiralCard.wrapFailedDetail"),
    },
    options?.dismissMs,
  );
}

// —— Packs ——

export function packInstalledPayload(
  name: string,
  version: string,
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "pack-install",
      label: t("toasts:packs.installed", { name, version }),
      status: "success",
    },
    options?.dismissMs,
  );
}

export function packInstallFailedPayload(
  err?: unknown,
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "pack-install",
      label: labelFromError(err, "toasts:packs.installFailed"),
    },
    options?.dismissMs,
  );
}

export function packReloadedPayload(options?: {
  dismissMs?: number | null;
}): ToastPayload {
  return withOptionalDismiss(
    {
      key: "pack-reload",
      label: t("toasts:packs.reloaded"),
      status: "success",
    },
    options?.dismissMs,
  );
}

// —— Themes ——

export function themeSavedPayload(options?: {
  dismissMs?: number | null;
}): ToastPayload {
  return withOptionalDismiss(
    {
      key: "theme-editor-save",
      label: t("toasts:themes.saved"),
      status: "success",
    },
    options?.dismissMs,
  );
}

export function themeSaveFailedPayload(
  err?: unknown,
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "theme-editor-save",
      label: labelFromError(err, "toasts:themes.saveFailed"),
    },
    options?.dismissMs,
  );
}

export function themeActivatedPayload(options?: {
  dismissMs?: number | null;
}): ToastPayload {
  return withOptionalDismiss(
    {
      key: "theme-editor-activate",
      label: t("toasts:themes.activated"),
      status: "success",
    },
    options?.dismissMs,
  );
}

export function themeActivateFailedPayload(
  err?: unknown,
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "theme-editor-activate",
      label: labelFromError(err, "toasts:themes.activateFailed"),
    },
    options?.dismissMs,
  );
}

export function themeDeletedPayload(options?: {
  dismissMs?: number | null;
}): ToastPayload {
  return withOptionalDismiss(
    {
      key: "theme-delete",
      label: t("toasts:themes.deleted"),
      status: "success",
    },
    options?.dismissMs,
  );
}

export function themeCreateFailedPayload(
  err?: unknown,
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "theme-create",
      label: labelFromError(err, "toasts:themes.createFailed"),
    },
    options?.dismissMs,
  );
}

export function themeApplyFailedPayload(
  err?: unknown,
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "theme-apply",
      label: labelFromError(err, "toasts:themes.applyFailed"),
    },
    options?.dismissMs,
  );
}

// —— Lyrics (instant) ——

export function lyricsNoneMissingPayload(options?: {
  dismissMs?: number | null;
}): ToastPayload {
  return withOptionalDismiss(
    {
      label: t("toasts:lyricsMissing.noneMissing"),
    },
    options?.dismissMs,
  );
}

export function lyricsAmbiguousPayload(
  title: string,
  options?: { dismissMs?: number | null; trackId?: number },
): ToastPayload {
  const settle = lyricsAmbiguousSettleOptions(title, options?.trackId ?? 0);
  return withOptionalDismiss(
    {
      key: "lyrics-fetch-bulk",
      label: settle.label,
      status: settle.status,
      actions: settle.actions,
    },
    options?.dismissMs,
  );
}

// —— Updates ——

export function availableUpdatePayload(
  version: string,
  actions: BackgroundTaskAction[],
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "updater",
      status: "info",
      label: t("common:updates.available.label"),
      detail: t("common:updates.available.detail", { version }),
      actions,
    },
    options?.dismissMs,
  );
}

export function updaterCheckErrorPayload(
  detail: string,
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "updater",
      label: t("common:updates.error.check"),
      detail,
    },
    options?.dismissMs,
  );
}
