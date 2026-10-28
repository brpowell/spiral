import { logActivity } from "./activityLog";
import { errorMessageFromUnknown } from "./cdPlaybackFailure";
import {
  importPickerFailedPayload,
  libraryLoadFailedPayload,
  libraryPlaybackFailedPayload,
  type ToastPayload,
} from "./toastPayloads";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";

type UnexpectedErrorKind = "libraryPlayback" | "libraryLoad" | "importPicker";

const KIND_CONFIG: Record<
  UnexpectedErrorKind,
  {
    domain: (typeof ACTIVITY_LOG_DOMAINS)[keyof typeof ACTIVITY_LOG_DOMAINS];
    defaultLogMessage: (raw: string) => string;
    payload: () => ToastPayload;
  }
> = {
  libraryPlayback: {
    domain: ACTIVITY_LOG_DOMAINS.libraryPlayback,
    defaultLogMessage: (raw) => `Library playback failed: ${raw}`,
    payload: () => libraryPlaybackFailedPayload({ logLink: true }),
  },
  libraryLoad: {
    domain: ACTIVITY_LOG_DOMAINS.libraryLoad,
    defaultLogMessage: (raw) => `Failed to load library: ${raw}`,
    payload: () => libraryLoadFailedPayload({ logLink: true }),
  },
  importPicker: {
    domain: ACTIVITY_LOG_DOMAINS.import,
    defaultLogMessage: (raw) => `Import failed: ${raw}`,
    payload: () => importPickerFailedPayload({ logLink: true }),
  },
};

/**
 * Friendly error toast + Activity Log for unexpected single-subject failures
 * (toast-conventions §6 / §4.3 / §4a). Raw errors stay in the log only.
 */
export function reportUnexpectedError(options: {
  kind: UnexpectedErrorKind;
  err: unknown;
  /** Extra fields stored on the activity-log entry (not shown in the toast). */
  details?: Record<string, unknown>;
  logMessage?: string;
}): void {
  const rawMessage = errorMessageFromUnknown(options.err);
  const config = KIND_CONFIG[options.kind];

  useBackgroundTasksStore.getState().showErrorToast(config.payload());

  logActivity({
    level: "error",
    domain: config.domain,
    message: options.logMessage ?? config.defaultLogMessage(rawMessage),
    details: {
      rawMessage,
      ...(options.details ?? {}),
    },
  });
}
