import { openUrl } from "@tauri-apps/plugin-opener";
import { t, type TranslationKey } from "./i18n";
import {
  isSpiralCardIntegrityError,
  parseUserErrorCode,
  translateUserError,
} from "./userError";
import { isMissingFileErrorDetail } from "./missingFileTrack";
import { lyricsAmbiguousSettleOptions } from "./lyricsFetchToastSettle";
import { formatPeerOutcomeTitle } from "./toastPeerOutcomes";
import type { ActivityLogRevealTarget } from "./activityLogsWindow";
import { TRIAL_MEMBER_URL } from "./trialGate";
import type {
  BackgroundTaskAction,
  BackgroundTaskSettleAsOptions,
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

function labelFromError(err: unknown, fallbackKey: TranslationKey): string {
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

/** Library playback unexpected failure (§6 + §4.3 generic). */
export function libraryPlaybackFailedPayload(options?: {
  dismissMs?: number | null;
  logLink?: ActivityLogRevealTarget;
}): ToastPayload {
  return withOptionalDismiss(
    {
      key: "library-playback-error",
      label: t("toasts:playback.failed"),
      detail: t("toasts:playback.failedDetail"),
      ...(options?.logLink ? { logLink: options.logLink } : {}),
    },
    options?.dismissMs,
  );
}

/** Library load unexpected failure (§6 + §4.3 generic). */
export function libraryLoadFailedPayload(options?: {
  dismissMs?: number | null;
  logLink?: ActivityLogRevealTarget;
}): ToastPayload {
  return withOptionalDismiss(
    {
      key: "library-load-error",
      label: t("toasts:library.loadFailed"),
      detail: t("toasts:library.loadFailedDetail"),
      ...(options?.logLink ? { logLink: options.logLink } : {}),
    },
    options?.dismissMs,
  );
}

/** File-picker / pre-import unexpected failure (§6 + §4.3 generic). */
export function importPickerFailedPayload(options?: {
  dismissMs?: number | null;
  logLink?: ActivityLogRevealTarget;
}): ToastPayload {
  return withOptionalDismiss(
    {
      key: "import-picker-error",
      label: t("toasts:import.pickerFailed"),
      detail: t("toasts:import.pickerFailedDetail"),
      ...(options?.logLink ? { logLink: options.logLink } : {}),
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

const HANDOFF_ERROR_RE = /^license\.handoff\.(network|expired|invalid)$/;

function openMemberPortalAction(
  onOpenMemberPortal?: () => void,
): BackgroundTaskAction {
  return {
    id: "open-member-portal",
    label: t("toasts:spiralCard.openMemberPortal"),
    variant: "primary",
    onClick: onOpenMemberPortal ?? (() => void openUrl(TRIAL_MEMBER_URL)),
  };
}

export function spiralCardInstallErrorPayload(
  err?: unknown,
  options?: {
    dismissMs?: number | null;
    onOpenMemberPortal?: () => void;
  },
): ToastPayload {
  const code = parseUserErrorCode(err);
  if (code === "license.installing.expired") {
    return withOptionalDismiss(
      {
        key: "spiral-card-install",
        label: t("errors:license.installing.expired.title"),
        detail: t("errors:license.installing.expired.detail"),
      },
      options?.dismissMs,
    );
  }
  if (code && isSpiralCardIntegrityError(code)) {
    return withOptionalDismiss(
      {
        key: "spiral-card-install",
        label: t(`errors:${code}.title` as TranslationKey),
        detail: t(`errors:${code}.detail` as TranslationKey),
        actions: [openMemberPortalAction(options?.onOpenMemberPortal)],
      },
      options?.dismissMs,
    );
  }
  if (code && HANDOFF_ERROR_RE.test(code)) {
    return withOptionalDismiss(
      {
        key: "spiral-card-install",
        label: t("errors:license.handoff.title"),
        detail: translateUserError(err) ?? undefined,
      },
      options?.dismissMs,
    );
  }
  return withOptionalDismiss(
    {
      key: "spiral-card-install",
      label: translateUserError(err) ?? t("toasts:spiralCard.installFailed"),
    },
    options?.dismissMs,
  );
}

export function spiralCardUpdatedPayload(options?: {
  dismissMs?: number | null;
}): ToastPayload {
  // Celebratory copy — linger past the default brief success timeout (2s).
  return withOptionalDismiss(
    {
      key: "spiral-card-update",
      label: t("toasts:spiralCard.updated"),
      detail: t("toasts:spiralCard.updatedDetail"),
    },
    options?.dismissMs !== undefined ? options.dismissMs : 6000,
  );
}

export function spiralCardUpdateNetworkErrorPayload(
  offline: boolean,
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "spiral-card-update",
      label: t("toasts:spiralCard.updateFailed"),
      detail: offline
        ? t("toasts:spiralCard.updateOffline")
        : t("toasts:spiralCard.updateConnection"),
    },
    options?.dismissMs,
  );
}

/** Known/expected throttle — toast-only, no Activity Log / View logs. */
export function spiralCardUpdateRateLimitedPayload(options?: {
  dismissMs?: number | null;
}): ToastPayload {
  return withOptionalDismiss(
    {
      key: "spiral-card-update",
      label: t("toasts:spiralCard.updateFailed"),
      detail: t("toasts:spiralCard.updateRateLimited"),
    },
    options?.dismissMs,
  );
}

/** Non-network grant pull failure — recover via a fresh card from the member portal. */
export function spiralCardUpdateFailedPayload(
  handlers?: { onOpenMemberPortal?: () => void },
  options?: { dismissMs?: number | null },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "spiral-card-update",
      label: t("toasts:spiralCard.updateCardProblem"),
      detail: t("toasts:spiralCard.updateCardProblemDetail"),
      actions: [openMemberPortalAction(handlers?.onOpenMemberPortal)],
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

/** File / picker install failure — friendly copy; raw errors go to the activity log. */
export function packInstallFailedPayload(options?: {
  dismissMs?: number | null;
  logLink?: ActivityLogRevealTarget;
}): ToastPayload {
  return withOptionalDismiss(
    {
      key: "pack-install",
      label: t("toasts:packs.installFailed"),
      detail: t("toasts:packs.installFailedDetail"),
      ...(options?.logLink ? { logLink: options.logLink } : {}),
    },
    options?.dismissMs,
  );
}

/**
 * Registry download/install failure (§6 single-subject + §4.3 generic).
 * Friendly copy in the toast; technical detail lives in the linked activity log.
 */
export function packDownloadFailedPayload(
  name: string,
  options?: {
    dismissMs?: number | null;
    logLink?: ActivityLogRevealTarget;
  },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "pack-registry-download",
      label: t("toasts:packs.downloadFailed", { name }),
      detail: t("toasts:packs.downloadFailedDetail"),
      ...(options?.logLink ? { logLink: options.logLink } : {}),
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

/**
 * Bulk pack update toast rules (peer counters — see toast-conventions.mdc §1–4).
 * - Title: number-first peer clauses, middot-joined, zero-suppressed.
 * - Prefix `Update:` when every surviving clause is generic (all-fail).
 * - Color from success/fail: all ok → success; mixed → warning; zero success → error.
 * - Exactly 1 failure → inline detail; 2+ → View logs.
 */
export function packUpdatesSettleOptions(options: {
  updated: number;
  failed: number;
  /** Per-item error strings (activity log); not shown inline for 2+ failures. */
  errors: string[];
  operationId: string;
}): BackgroundTaskSettleAsOptions & { label: string } {
  const { updated, failed, operationId } = options;

  const label = formatPeerOutcomeTitle(
    [
      ...(updated > 0
        ? [
            {
              text: t("toasts:packs.updatedCount", { count: updated }),
              anchored: true,
            },
          ]
        : []),
      ...(failed > 0
        ? [{ text: t("toasts:packs.updateFailedCount", { count: failed }) }]
        : []),
    ],
    {
      operation: t("toasts:packs.updateOperation"),
      fallback: t("toasts:packs.updateFailedFallback"),
    },
  );

  if (failed === 0) {
    return { status: "success", label };
  }

  const status = updated > 0 ? "warning" : "error";

  if (failed === 1) {
    return {
      status,
      label,
      detail: t("toasts:packs.downloadFailedDetail"),
      logLink: { operationId },
    };
  }

  return {
    status,
    label,
    logLink: { operationId },
  };
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

// —— CD metadata ——

export function cdMetadataFoundSettleOptions(options?: {
  album?: string | null;
}): BackgroundTaskSettleAsOptions {
  const album = options?.album?.trim();
  return {
    status: "success",
    label: t("toasts:cdMetadata.found"),
    ...(album ? { detail: album } : {}),
  };
}

export function cdHeroArtFetchedSettleOptions(options?: {
  album?: string | null;
}): BackgroundTaskSettleAsOptions {
  const album = options?.album?.trim();
  return {
    status: "success",
    label: t("toasts:cdMetadata.fetchedArt"),
    ...(album ? { detail: album } : {}),
  };
}

export function cdMetadataNotFoundSettleOptions(): BackgroundTaskSettleAsOptions {
  return {
    status: "warning",
    label: t("toasts:cdMetadata.notFound"),
  };
}

/** Lookup transport / HTTP failure (§6 + §4.3 generic). Rust already logged the error. */
export function cdMetadataFailedSettleOptions(options: {
  logLink: ActivityLogRevealTarget;
}): BackgroundTaskSettleAsOptions {
  return {
    status: "error",
    label: t("toasts:cdMetadata.failed"),
    detail: t("toasts:cdMetadata.failedDetail"),
    logLink: options.logLink,
  };
}

/** Unexpected CD import abort (§6 + §4.3 generic). Raw errors stay in the activity log. */
export function cdImportFailedSettleOptions(options: {
  logLink: ActivityLogRevealTarget;
}): BackgroundTaskSettleAsOptions {
  return {
    status: "error",
    label: t("toasts:import.cdFailed"),
    detail: t("toasts:import.cdFailedDetail"),
    logLink: options.logLink,
  };
}

// —— Updates ——

export function availableUpdatePayload(
  version: string,
  actions: BackgroundTaskAction[],
  options?: { dismissMs?: number | null; simulated?: boolean },
): ToastPayload {
  return withOptionalDismiss(
    {
      key: "updater",
      status: "info",
      label: t("common:updates.available.label"),
      detail: options?.simulated
        ? `Version ${version} is ready to install. (simulated)`
        : t("common:updates.available.detail", { version }),
      actions,
    },
    options?.dismissMs,
  );
}

export function availableUpdateActions(handlers: {
  onUpdate: () => void;
  onWhatsNew: () => void;
}): BackgroundTaskAction[] {
  return [
    {
      id: "update",
      label: t("common:updates.available.update"),
      variant: "primary",
      onClick: handlers.onUpdate,
    },
    {
      id: "whats-new",
      label: t("common:updates.available.whatsNew"),
      variant: "secondary",
      onClick: handlers.onWhatsNew,
    },
  ];
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
