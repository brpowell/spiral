import { logActivity } from "../activityLog";
import { errorMessageFromUnknown } from "../cdPlaybackFailure";
import type { InstallItemResult } from "../tauri";
import { ACTIVITY_LOG_DOMAINS } from "../../types/activityLog";

/** Activity log for a successful item install from a file. */
export function logItemInstallSuccess(options: {
  result: InstallItemResult;
}): void {
  const { result } = options;
  logActivity({
    level: "info",
    domain: ACTIVITY_LOG_DOMAINS.studio,
    message: `Installed ${result.name} (${result.effectiveId}@${result.version}) from file`,
    details: {
      source: "file",
      name: result.name,
      itemType: result.itemType,
      effectiveId: result.effectiveId,
      version: result.version,
      dir: result.dir,
      ...(result.replacedVersion != null
        ? { replacedVersion: result.replacedVersion }
        : {}),
    },
  });
}

/** Activity log for a successful registry install (provenance in `details`). */
export function logRegistryInstallSuccess(options: {
  result: InstallItemResult;
  registryUrl: string;
  sha256?: string;
  sizeBytes?: number;
  minAppVersion?: string | null;
}): void {
  const { result } = options;
  logActivity({
    level: "info",
    domain: ACTIVITY_LOG_DOMAINS.studio,
    message: `Installed ${result.name} (${result.effectiveId}@${result.version}) from registry`,
    details: {
      source: "registry",
      name: result.name,
      itemType: result.itemType,
      effectiveId: result.effectiveId,
      version: result.version,
      dir: result.dir,
      registryUrl: options.registryUrl,
      ...(result.replacedVersion != null
        ? { replacedVersion: result.replacedVersion }
        : {}),
      ...(options.sha256 != null ? { sha256: options.sha256 } : {}),
      ...(options.sizeBytes != null ? { sizeBytes: options.sizeBytes } : {}),
      ...(options.minAppVersion != null && options.minAppVersion !== ""
        ? { minAppVersion: options.minAppVersion }
        : {}),
    },
  });
}

/** Activity log for a failed registry download/install (raw error in details). */
export function logRegistryInstallFailure(options: {
  err: unknown;
  name?: string;
  registryUrl: string;
  publisherId: string;
  itemType: string;
  id: string;
  version: string;
  sha256?: string;
  sizeBytes?: number;
  minAppVersion?: string | null;
}): void {
  const rawMessage = errorMessageFromUnknown(options.err);
  const subject =
    options.name?.trim() ||
    `${options.publisherId}.${options.itemType}.${options.id}@${options.version}`;

  logActivity({
    level: "error",
    domain: ACTIVITY_LOG_DOMAINS.studio,
    message: `Item download failed for ${subject}: ${rawMessage}`,
    details: {
      source: "registry",
      error: rawMessage,
      registryUrl: options.registryUrl,
      publisherId: options.publisherId,
      itemType: options.itemType,
      id: options.id,
      version: options.version,
      ...(options.name != null ? { name: options.name } : {}),
      ...(options.sha256 != null ? { sha256: options.sha256 } : {}),
      ...(options.sizeBytes != null ? { sizeBytes: options.sizeBytes } : {}),
      ...(options.minAppVersion != null && options.minAppVersion !== ""
        ? { minAppVersion: options.minAppVersion }
        : {}),
    },
  });
}

/** Activity log for a failed file install (raw error in details). */
export function logItemInstallFailure(options: {
  err: unknown;
  name?: string;
  path?: string;
}): void {
  const rawMessage = errorMessageFromUnknown(options.err);
  const subject = options.name?.trim() || options.path || "item";
  logActivity({
    level: "error",
    domain: ACTIVITY_LOG_DOMAINS.studio,
    message: `Item install failed for ${subject}: ${rawMessage}`,
    details: {
      source: "file",
      error: rawMessage,
      ...(options.name != null ? { name: options.name } : {}),
      ...(options.path != null ? { path: options.path } : {}),
    },
  });
}
