import { logActivity } from "./activityLog";
import { cdPlaybackFailurePayload } from "./toastPayloads";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";

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
 * Toast + activity log for a CD playback failure.
 * Dedupes rapid repeats for the same drive.
 * Known kinds (disconnect / no disc) are toast-only; generic/unhandled gets View logs.
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

  useBackgroundTasksStore.getState().showErrorToast(
    cdPlaybackFailurePayload(kind, options.message, {
      ...(kind === "generic" ? { logLink: true } : {}),
    }),
  );

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
