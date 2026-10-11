import { create } from "zustand";
import { t } from "../lib/i18n";
import {
  AUTOMATIC_UPDATE_INTERVAL_MS,
  checkForAvailableUpdate,
  createMockAvailableUpdate,
  downloadAndInstallPendingUpdate,
  isUpdaterEnabled,
  simulateMockUpdateInstall,
  type AvailableUpdateInfo,
  type UpdateCheckReason,
} from "../lib/updater";
import { saveLibrarySettings } from "../lib/tauri";
import {
  availableUpdateActions,
  availableUpdatePayload,
} from "../lib/toastPayloads";
import { isTauri } from "../lib/windowRole";
import {
  useBackgroundTasksStore,
  type BackgroundTaskAction,
  type BackgroundTaskSettleAsOptions,
} from "./useBackgroundTasksStore";
import { useWhatsNewStore } from "./useWhatsNewStore";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "upToDate"
  | "downloading"
  | "ready"
  | "error";

const UPDATER_TOAST_KEY = "updater";
const UPDATER_INSTALL_TASK_KEY = "updater-install";

interface UpdaterState {
  status: UpdaterStatus;
  availableUpdate: AvailableUpdateInfo | null;
  /** DEV-only: pending update was seeded by Simulate Update, not the live plugin. */
  mockRelease: boolean;
  lastError: string | null;
  downloadedBytes: number;
  contentLength: number | null;
  automaticChecksEnabled: boolean;
  /**
   * Version whose "update available" toast was already shown.
   * Periodic automatic re-checks of the same version must not re-nag.
   */
  notifiedUpdateVersion: string | null;
  /** Sync from loaded library settings (default on until settings arrive). */
  applyAutomaticChecksEnabled: (enabled: boolean) => void;
  setAutomaticChecksEnabled: (enabled: boolean) => Promise<void>;
  checkForUpdates: (options?: {
    reason?: UpdateCheckReason;
  }) => Promise<AvailableUpdateInfo | null>;
  installAvailableUpdate: () => Promise<void>;
  /**
   * DEV-only: seed a fake pending release and show the update toast.
   * Does not call the live updater endpoint.
   */
  simulateMockUpdate: () => void;
  startAutomaticUpdateChecks: () => () => void;
}

function surfaceUpdaterError(label: string, detail?: string): void {
  useBackgroundTasksStore.getState().showErrorToast({
    key: UPDATER_TOAST_KEY,
    label,
    detail,
  });
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

function updaterAvailableUpdateActions(): BackgroundTaskAction[] {
  return availableUpdateActions({
    onUpdate: () => {
      void useUpdaterStore.getState().installAvailableUpdate();
    },
    onWhatsNew: () => {
      const version = useUpdaterStore.getState().availableUpdate?.version;
      useWhatsNewStore.getState().openWhatsNew(version);
    },
  });
}

function availableUpdatePresentation(
  update: AvailableUpdateInfo,
): BackgroundTaskSettleAsOptions {
  const { label, detail, actions } = availableUpdatePayload(
    update.version,
    updaterAvailableUpdateActions(),
    { dismissMs: null },
  );
  return {
    status: "info",
    label,
    detail,
    actions,
  };
}

function showAvailableUpdateToast(
  update: AvailableUpdateInfo,
  simulated = false,
): void {
  useBackgroundTasksStore.getState().showToast(
    availableUpdatePayload(update.version, updaterAvailableUpdateActions(), {
      dismissMs: null,
      simulated,
    }),
  );
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  availableUpdate: null,
  mockRelease: false,
  lastError: null,
  downloadedBytes: 0,
  contentLength: null,
  automaticChecksEnabled: true,
  notifiedUpdateVersion: null,

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
    if (!isUpdaterEnabled()) {
      if (reason === "automatic") return null;
      const message = t("common:updates.error.disabledInDev");
      const detail = t("common:updates.error.disabledInDevDetail");
      set({ status: "error", lastError: message });
      surfaceUpdaterError(message, detail);
      return null;
    }
    if (reason === "automatic" && !get().automaticChecksEnabled) return null;

    const previousStatus = get().status;
    const previousAvailable = get().availableUpdate;
    set({
      status: "checking",
      lastError: null,
    });

    const applyAvailable = (
      available: AvailableUpdateInfo,
      notify: boolean,
    ): void => {
      set({
        status: "available",
        availableUpdate: available,
        mockRelease: false,
        lastError: null,
      });
      if (notify) {
        set({ notifiedUpdateVersion: available.version });
      }
    };

    const applyUpToDate = (): void => {
      set({
        status: "upToDate",
        availableUpdate: null,
        mockRelease: false,
        lastError: null,
        notifiedUpdateVersion: null,
      });
    };

    const applyCheckFailure = (message: string): boolean => {
      const keepPending =
        previousStatus === "available" || previousAvailable != null;
      set({
        status: keepPending ? "available" : "error",
        lastError: message,
        availableUpdate: keepPending ? previousAvailable : null,
      });
      return keepPending;
    };

    if (reason === "manual") {
      return await new Promise<AvailableUpdateInfo | null>((resolve) => {
        useBackgroundTasksStore.getState().runInBackground({
          key: UPDATER_TOAST_KEY,
          label: t("common:updates.checking"),
          run: async (ctx) => {
            try {
              const available = await checkForAvailableUpdate();

              if (available) {
                applyAvailable(available, true);
                ctx.settleAs(availableUpdatePresentation(available));
                resolve(available);
                return;
              }

              applyUpToDate();
              ctx.settleAs({
                status: "success",
                label: t("common:updates.upToDate"),
              });
              resolve(null);
            } catch (err) {
              const message = errorMessage(
                err,
                t("common:updates.error.check"),
              );
              applyCheckFailure(message);
              ctx.settleAs({
                status: "error",
                label: t("common:updates.error.check"),
                detail: message,
              });
              resolve(null);
            }
          },
        });
      });
    }

    try {
      const available = await checkForAvailableUpdate();

      if (available) {
        const alreadyNotified =
          get().notifiedUpdateVersion === available.version;
        const shouldNotify = !alreadyNotified;
        applyAvailable(available, shouldNotify);
        if (shouldNotify) {
          showAvailableUpdateToast(available);
        }
        return available;
      }

      applyUpToDate();
      return null;
    } catch (err) {
      const message = errorMessage(err, t("common:updates.error.check"));
      // Avoid nagging on background re-check failures while an update is pending.
      if (!applyCheckFailure(message)) {
        surfaceUpdaterError(t("common:updates.error.check"), message);
      }
      return null;
    }
  },

  simulateMockUpdate: () => {
    if (!import.meta.env.DEV) return;
    if (!isTauri()) return;

    const existing = get().availableUpdate;
    if (existing && get().mockRelease) {
      showAvailableUpdateToast(existing, true);
      set({ notifiedUpdateVersion: existing.version });
      return;
    }

    const available = createMockAvailableUpdate(
      existing?.currentVersion ?? "0.0.0",
    );
    set({
      status: "available",
      availableUpdate: available,
      mockRelease: true,
      lastError: null,
      notifiedUpdateVersion: available.version,
    });
    showAvailableUpdateToast(available, true);
  },

  installAvailableUpdate: async () => {
    if (!isTauri()) return;
    if (get().status === "downloading") return;
    const isMock = get().mockRelease;
    if (!isMock && !isUpdaterEnabled()) {
      const message = t("common:updates.error.disabledInDev");
      const detail = t("common:updates.error.disabledInDevDetail");
      set({ status: "error", lastError: message });
      surfaceUpdaterError(message, detail);
      return;
    }
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

    const runInstall = isMock
      ? simulateMockUpdateInstall
      : downloadAndInstallPendingUpdate;

    await new Promise<void>((resolve) => {
      useBackgroundTasksStore.getState().runInBackground({
        key: UPDATER_INSTALL_TASK_KEY,
        label: t("common:updates.downloading"),
        progressDisplay: "bar",
        run: async (ctx) => {
          try {
            await runInstall(({ downloadedBytes, contentLength }) => {
              set({
                status: "downloading",
                downloadedBytes,
                contentLength,
              });
              if (contentLength != null && contentLength > 0) {
                ctx.setProgress(downloadedBytes, contentLength);
              }
            });
            // Real path: relaunch() ends the process. Mock path: location.reload().
            // If either returns, clear pending state.
            set({
              status: "ready",
              availableUpdate: null,
              mockRelease: false,
              notifiedUpdateVersion: null,
            });
            ctx.dismissSilently();
            resolve();
          } catch (err) {
            const message = errorMessage(
              err,
              t("common:updates.error.install"),
            );
            set({ status: "error", lastError: message });
            ctx.setLabel(t("common:updates.error.install"));
            resolve();
            throw new Error(message);
          }
        },
      });
    });
  },

  startAutomaticUpdateChecks: () => {
    if (!isTauri() || !isUpdaterEnabled()) return () => {};

    void get().checkForUpdates({ reason: "automatic" });

    const intervalId = globalThis.setInterval(() => {
      void get().checkForUpdates({ reason: "automatic" });
    }, AUTOMATIC_UPDATE_INTERVAL_MS);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  },
}));
