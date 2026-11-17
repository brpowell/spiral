import { logActivity } from "@/lib/activity/activityLog";
import {
  cdPlaybackDamagedPayload,
  cdPlaybackFailurePayload,
} from "@/lib/toast/toastPayloads";
import { useBackgroundTasksStore } from "@/store/useBackgroundTasksStore";
import { ACTIVITY_LOG_DOMAINS } from "@/types/activityLog";

/** Tauri event the CD engine emits (once per session) when it plays over unreadable sectors. */
export const CD_PLAYBACK_DAMAGED_EVENT = "cd-playback-damaged";

export interface CdPlaybackDamagedPayload {
  driveId: string;
  trackNumber: number;
  damagedSectors: number;
}

const DEDUPE_MS = 2_500;

let lastReportAt = 0;
let lastReportDriveId: string | null = null;

export type CdPlaybackFailureKind =
  "disconnected" | "no_disc" | "unreadable" | "generic";

/** Backend / probe messages that mean the optical device or media is gone. */
export function classifyCdPlaybackFailure(
  message: string,
): CdPlaybackFailureKind {
  const normalized = message.trim().toLowerCase();
  // Checked first: the engine gave up because a damaged disc can't be read in real time.
  if (normalized.includes("too damaged to read")) {
    return "unreadable";
  }
  if (
    normalized.includes("disc drive disconnected") ||
    normalized.includes("drive not found") ||
    // Isolated unreadable sectors are skipped natively; this only surfaces once a long run of
    // reads fails in a row, which in practice means the drive went away.
    normalized.includes("failed to read cd audio")
  ) {
    return "disconnected";
  }
  if (normalized.includes("no audio cd in drive")) {
    return "no_disc";
  }
  return "generic";
}

/** Prefix the Rust rip path puts on the error when a sector stays unreadable after retries. */
export const CD_UNREADABLE_SECTOR_MESSAGE = "Unreadable section of disc";

export function isCdUnreadableSectorError(message: string): boolean {
  return message.includes(CD_UNREADABLE_SECTOR_MESSAGE);
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
        : kind === "unreadable"
          ? "CD playback stopped — disc too damaged to read in real time"
          : `CD playback failed: ${options.message}`;

  logActivity({
    level: kind === "generic" ? "error" : "warn",
    domain: ACTIVITY_LOG_DOMAINS.playback,
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

/**
 * A CD track is playing over unreadable sectors that were replaced with silence.
 * Playback continues, so this is a warning toast + log entry, not a failure.
 */
export function reportCdPlaybackDamage(
  options: CdPlaybackDamagedPayload,
): void {
  useBackgroundTasksStore
    .getState()
    .showToast(cdPlaybackDamagedPayload(options.trackNumber));
  logActivity({
    level: "warn",
    domain: ACTIVITY_LOG_DOMAINS.playback,
    message: `CD track ${options.trackNumber} has unreadable sections — played as silence`,
    context: { driveId: options.driveId },
    details: {
      trackNumber: options.trackNumber,
      damagedSectors: options.damagedSectors,
    },
  });
}

/** Test helper — reset dedupe state between cases. */
export function resetCdPlaybackFailureDedupeForTests(): void {
  lastReportAt = 0;
  lastReportDriveId = null;
}
