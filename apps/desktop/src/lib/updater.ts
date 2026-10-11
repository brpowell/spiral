import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "./windowRole";

/** Background check cadence while the app stays open (within the 4–6h plan window). */
export const AUTOMATIC_UPDATE_INTERVAL_MS = 5 * 60 * 60 * 1000;

/**
 * Process env that re-enables the updater during `tauri dev` / Vite DEV.
 * Set to `1` or `true` when intentionally testing update checks from a debug session.
 * See `docs/release.md` ("Debug builds and the updater").
 */
export const UPDATER_ENABLE_ENV = "SPIRAL_ENABLE_UPDATER";

/** Fake version used by Developer → Simulate Update (never a real release). */
export const MOCK_UPDATE_VERSION = "99.0.0";

const MOCK_INSTALL_TOTAL_BYTES = 20_000_000;
const MOCK_INSTALL_STEPS = 20;
const MOCK_INSTALL_STEP_MS = 100;

export type UpdateCheckReason = "automatic" | "manual";

export interface AvailableUpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

/**
 * In-memory pending update for DEV simulation. Does not touch the live plugin.
 */
export function createMockAvailableUpdate(
  currentVersion = "0.0.0",
): AvailableUpdateInfo {
  return {
    version: MOCK_UPDATE_VERSION,
    currentVersion,
    date: new Date().toISOString(),
    body: [
      "### Features",
      "",
      "* Simulated release for local update UX testing",
      "",
      "### Bug Fixes",
      "",
      "* Example fix shown only in Developer → Simulate Update",
    ].join("\n"),
  };
}

/** Thrown when check/install is attempted while the debug hard gate is active. */
export class UpdaterDisabledInDevError extends Error {
  readonly code = "updater_disabled_in_dev" as const;

  constructor() {
    super("Updater is disabled in debug builds");
    this.name = "UpdaterDisabledInDevError";
  }
}

/**
 * Whether the app may talk to the live update endpoint / install updates.
 *
 * Release builds: always on.
 * DEV (`tauri dev` / Vite): off unless {@link UPDATER_ENABLE_ENV} is `1`/`true`.
 *
 * Why: debug binaries live under `src-tauri/target/debug/`; accepting a live
 * update can unpack a release bundle over that tree and relaunch outside the
 * Vite-driven session. Packaged installs are unaffected.
 */
export function isUpdaterEnabled(options?: {
  isDev?: boolean;
  enableFlag?: string | undefined;
}): boolean {
  const isDev = options?.isDev ?? import.meta.env.DEV;
  if (!isDev) return true;

  const flag = options?.enableFlag ?? import.meta.env.SPIRAL_ENABLE_UPDATER;
  const normalized = flag?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
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
  if (!isUpdaterEnabled()) return null;

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
  if (!isUpdaterEnabled()) {
    throw new UpdaterDisabledInDevError();
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

/**
 * Fake download progress then reload the window — DEV mock path only.
 * Uses a webview reload (not process `relaunch`) so `tauri dev` stays alive.
 * Never calls the updater plugin.
 */
export async function simulateMockUpdateInstall(
  onProgress?: (progress: UpdateDownloadProgress) => void,
): Promise<void> {
  if (!isTauri()) {
    throw new Error("Updater is only available in the desktop app");
  }

  const contentLength = MOCK_INSTALL_TOTAL_BYTES;
  onProgress?.({ downloadedBytes: 0, contentLength });

  for (let step = 1; step <= MOCK_INSTALL_STEPS; step++) {
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, MOCK_INSTALL_STEP_MS);
    });
    const downloadedBytes = Math.round(
      (contentLength * step) / MOCK_INSTALL_STEPS,
    );
    onProgress?.({ downloadedBytes, contentLength });
  }

  // Real updates call relaunch(); mock uses reload so the cargo/Vite session
  // is not killed (relaunch exits the debug binary and leaves a white window).
  globalThis.location.reload();
}
