import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "./windowRole";

/** Background check cadence while the app stays open (within the 4–6h plan window). */
export const AUTOMATIC_UPDATE_INTERVAL_MS = 5 * 60 * 60 * 1000;

export type UpdateCheckReason = "automatic" | "manual";

export interface AvailableUpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

/** Holds the live plugin Update until install or a newer check replaces it. */
let pendingUpdate: Update | null = null;

export function clearPendingUpdate(): void {
  const previous = pendingUpdate;
  pendingUpdate = null;
  if (previous) {
    void previous.close().catch(() => {
      /* ignore close errors after replace/install */
    });
  }
}

export async function checkForAvailableUpdate(): Promise<AvailableUpdateInfo | null> {
  if (!isTauri()) return null;

  const update = await check();
  clearPendingUpdate();

  if (!update) return null;

  pendingUpdate = update;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date,
    body: update.body,
  };
}

export type UpdateDownloadProgress = {
  downloadedBytes: number;
  contentLength: number | null;
};

export async function downloadAndInstallPendingUpdate(
  onProgress?: (progress: UpdateDownloadProgress) => void,
): Promise<void> {
  if (!isTauri()) {
    throw new Error("Updater is only available in the desktop app");
  }

  const update = pendingUpdate;
  if (!update) {
    throw new Error("No update is ready to install");
  }

  let downloadedBytes = 0;
  let contentLength: number | null = null;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? null;
        downloadedBytes = 0;
        onProgress?.({ downloadedBytes, contentLength });
        break;
      case "Progress":
        downloadedBytes += event.data.chunkLength;
        onProgress?.({ downloadedBytes, contentLength });
        break;
      case "Finished":
        onProgress?.({ downloadedBytes, contentLength });
        break;
    }
  });

  clearPendingUpdate();
  await relaunch();
}
