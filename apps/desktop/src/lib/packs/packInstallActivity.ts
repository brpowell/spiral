import { logActivity } from "../activityLog";
import { errorMessageFromUnknown } from "../cdPlaybackFailure";
import type { InstallItemResult, InstallPackResult } from "../tauri";
import { ACTIVITY_LOG_DOMAINS } from "../../types/activityLog";

export type PackInstallSource = "registry" | "file";

/** Activity log for a successful pack install (provenance in `details`). */
export function logPackInstallSuccess(options: {
  operationId: string;
  source: PackInstallSource;
  result: InstallPackResult;
  /** Registry base URL when `source === "registry"`. */
  registryUrl?: string;
  publisherId?: string;
  sha256?: string;
  sizeBytes?: number;
  minAppVersion?: string | null;
}): void {
  const { operationId, source, result } = options;
  const identity = `${options.publisherId ?? "?"}.${result.packId}@${result.version}`;
  logActivity({
    level: "info",
    domain: ACTIVITY_LOG_DOMAINS.packInstall,
    message:
      source === "registry"
        ? `Installed ${result.name} (${identity}) from registry`
        : `Installed ${result.name} (${result.packId}@${result.version}) from file`,
    operationId,
    details: {
      source,
      name: result.name,
      packId: result.packId,
      version: result.version,
      packDir: result.packDir,
      contributionCount: result.contributionCount,
      ...(options.registryUrl != null
        ? { registryUrl: options.registryUrl }
        : {}),
      ...(options.publisherId != null ? { publisherId: options.publisherId } : {}),
      ...(options.sha256 != null ? { sha256: options.sha256 } : {}),
      ...(options.sizeBytes != null ? { sizeBytes: options.sizeBytes } : {}),
      ...(options.minAppVersion != null && options.minAppVersion !== ""
        ? { minAppVersion: options.minAppVersion }
        : {}),
    },
  });
}

/** Activity log for a successful item install from a file. */
export function logItemInstallSuccess(options: {
  operationId: string;
  result: InstallItemResult;
}): void {
  const { operationId, result } = options;
  logActivity({
    level: "info",
    domain: ACTIVITY_LOG_DOMAINS.packInstall,
    message: `Installed ${result.name} (${result.effectiveId}@${result.version}) from file`,
    operationId,
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

/** Activity log for a failed pack install/download (raw error in details). */
export function logPackInstallFailure(options: {
  operationId: string;
  source: PackInstallSource;
  err: unknown;
  name?: string;
  registryUrl?: string;
  publisherId?: string;
  packId?: string;
  version?: string;
  sha256?: string;
  sizeBytes?: number;
  minAppVersion?: string | null;
}): void {
  const rawMessage = errorMessageFromUnknown(options.err);
  const subject =
    options.name?.trim() ||
    (options.packId != null && options.version != null
      ? `${options.packId}@${options.version}`
      : options.packId) ||
    "pack";

  logActivity({
    level: "error",
    domain: ACTIVITY_LOG_DOMAINS.packInstall,
    message:
      options.source === "registry"
        ? `Pack download failed for ${subject}: ${rawMessage}`
        : `Pack install failed for ${subject}: ${rawMessage}`,
    operationId: options.operationId,
    details: {
      source: options.source,
      error: rawMessage,
      ...(options.name != null ? { name: options.name } : {}),
      ...(options.registryUrl != null
        ? { registryUrl: options.registryUrl }
        : {}),
      ...(options.publisherId != null ? { publisherId: options.publisherId } : {}),
      ...(options.packId != null ? { packId: options.packId } : {}),
      ...(options.version != null ? { version: options.version } : {}),
      ...(options.sha256 != null ? { sha256: options.sha256 } : {}),
      ...(options.sizeBytes != null ? { sizeBytes: options.sizeBytes } : {}),
      ...(options.minAppVersion != null && options.minAppVersion !== ""
        ? { minAppVersion: options.minAppVersion }
        : {}),
    },
  });
}
