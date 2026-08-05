import { logActivity } from "./activityLog";
import { t } from "./i18n";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";

const CD_PLAYBACK_TOAST_KEY = "cd-playback-error";
const DEDUPE_MS = 2_500;

let lastReportAt = 0;
let lastReportDriveId: string | null = null;

export type CdPlaybackFailureKind = "disconnected" | "no_disc" | "generic";

/** Backend / probe messages that mean the optical device or media is gone. */
export function classifyCdPlaybackFailure(
  message: string,
): CdPlaybackFailureKind {
  const normalized = message.trim().toLowerCase();
  if (
    normalized.includes("disc drive disconnected") ||
    normalized.includes("drive not found") ||
    // Mid-stream I/O death is usually a yank; scratched-disc reads are rarer here.
    normalized.includes("failed to read cd audio")
  ) {
    return "disconnected";
  }
  if (normalized.includes("no audio cd in drive")) {
    return "no_disc";
  }
  return "generic";
}

export function errorMessageFromUnknown(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return "Unknown error";
}

/**
 * Toast + activity log for a CD playback failure (no sticky import-error banner).
 * Dedupes rapid repeats for the same drive.
 */
export function reportCdPlaybackFailure(options: {
  message: string;
  driveId?: string | null;
  trackNumber?: number | null;
}): CdPlaybackFailureKind {
  const kind = classifyCdPlaybackFailure(options.message);
  const driveId = options.driveId?.trim() || null;
  const now = Date.now();
  if (
    driveId != null &&
    driveId === lastReportDriveId &&
    now - lastReportAt < DEDUPE_MS
  ) {
    return kind;
  }
  lastReportAt = now;
  lastReportDriveId = driveId;

  const label =
    kind === "disconnected"
      ? t("playback:cd.disconnected.label")
      : t("playback:cd.playbackFailed.label");
  const detail =
    kind === "disconnected"
      ? t("playback:cd.disconnected.detail")
      : kind === "no_disc"
        ? t("playback:cd.noDisc.detail")
        : options.message;

  useBackgroundTasksStore.getState().showErrorToast({
    key: CD_PLAYBACK_TOAST_KEY,
    label,
    detail,
  });

  const logMessage =
    kind === "disconnected"
      ? "CD playback stopped — disc drive disconnected"
      : kind === "no_disc"
        ? "CD playback failed — no audio CD in drive"
        : `CD playback failed: ${options.message}`;

  logActivity({
    level: kind === "generic" ? "error" : "warn",
    domain: ACTIVITY_LOG_DOMAINS.cdPlayback,
    message: logMessage,
    context: driveId != null ? { driveId } : undefined,
    details: {
      kind,
      rawMessage: options.message,
      ...(options.trackNumber != null
        ? { trackNumber: options.trackNumber }
        : {}),
    },
  });

  return kind;
}

/** Test helper — reset dedupe state between cases. */
export function resetCdPlaybackFailureDedupeForTests(): void {
  lastReportAt = 0;
  lastReportDriveId = null;
}
