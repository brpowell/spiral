import { create } from "zustand";
import { t } from "../lib/i18n";
import {
  AUTOMATIC_UPDATE_INTERVAL_MS,
  checkForAvailableUpdate,
  downloadAndInstallPendingUpdate,
  type AvailableUpdateInfo,
  type UpdateCheckReason,
} from "../lib/updater";
import { saveLibrarySettings } from "../lib/tauri";
import { isTauri } from "../lib/windowRole";
import { useBackgroundTasksStore } from "./useBackgroundTasksStore";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "upToDate"
  | "downloading"
  | "ready"
  | "error";

interface UpdaterState {
  status: UpdaterStatus;
  availableUpdate: AvailableUpdateInfo | null;
  lastError: string | null;
  downloadedBytes: number;
  contentLength: number | null;
  automaticChecksEnabled: boolean;
  /** Sync from loaded library settings (default on until settings arrive). */
  applyAutomaticChecksEnabled: (enabled: boolean) => void;
  setAutomaticChecksEnabled: (enabled: boolean) => Promise<void>;
  checkForUpdates: (options?: {
    reason?: UpdateCheckReason;
  }) => Promise<AvailableUpdateInfo | null>;
  installAvailableUpdate: () => Promise<void>;
  startAutomaticUpdateChecks: () => () => void;
}

function surfaceUpdaterError(label: string, detail?: string): void {
  useBackgroundTasksStore.getState().showErrorToast({
    key: "updater",
    label,
    detail,
  });
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  availableUpdate: null,
  lastError: null,
  downloadedBytes: 0,
  contentLength: null,
  automaticChecksEnabled: true,

  applyAutomaticChecksEnabled: (enabled) => {
    set({ automaticChecksEnabled: enabled });
  },

  setAutomaticChecksEnabled: async (enabled) => {
    set({ automaticChecksEnabled: enabled });
    try {
      await saveLibrarySettings({ automaticUpdateChecksEnabled: enabled });
    } catch (err) {
      const message = errorMessage(
        err,
        t("common:updates.error.savePreference"),
      );
      set({ status: "error", lastError: message });
      surfaceUpdaterError(t("common:updates.error.savePreference"), message);
      throw err;
    }
  },

  checkForUpdates: async ({ reason = "manual" } = {}) => {
    if (!isTauri()) return null;
    if (reason === "automatic" && !get().automaticChecksEnabled) return null;

    const previousStatus = get().status;
    set({
      status: "checking",
      lastError: null,
    });

    try {
      const available = await checkForAvailableUpdate();
      if (available) {
        set({
          status: "available",
          availableUpdate: available,
          lastError: null,
        });
        return available;
      }

      set({
        status: "upToDate",
        availableUpdate: null,
        lastError: null,
      });
      return null;
    } catch (err) {
      const message = errorMessage(err, t("common:updates.error.check"));
      set({
        status: "error",
        lastError: message,
        // Keep prior available metadata if a re-check failed mid-pending.
        availableUpdate:
          previousStatus === "available" ? get().availableUpdate : null,
      });
      surfaceUpdaterError(t("common:updates.error.check"), message);
      return null;
    }
  },

  installAvailableUpdate: async () => {
    if (!isTauri()) return;
    if (!get().availableUpdate) {
      const message = t("common:updates.error.noUpdate");
      set({ status: "error", lastError: message });
      surfaceUpdaterError(message);
      return;
    }

    set({
      status: "downloading",
      lastError: null,
      downloadedBytes: 0,
      contentLength: null,
    });

    try {
      await downloadAndInstallPendingUpdate(
        ({ downloadedBytes, contentLength }) => {
          set({
            status: "downloading",
            downloadedBytes,
            contentLength,
          });
        },
      );
      // relaunch() normally ends the process; if it returns, mark ready.
      set({ status: "ready" });
    } catch (err) {
      const message = errorMessage(err, t("common:updates.error.install"));
      set({ status: "error", lastError: message });
      surfaceUpdaterError(t("common:updates.error.install"), message);
    }
  },

  startAutomaticUpdateChecks: () => {
    if (!isTauri()) return () => {};

    void get().checkForUpdates({ reason: "automatic" });

    const intervalId = globalThis.setInterval(() => {
      void get().checkForUpdates({ reason: "automatic" });
    }, AUTOMATIC_UPDATE_INTERVAL_MS);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  },
}));
