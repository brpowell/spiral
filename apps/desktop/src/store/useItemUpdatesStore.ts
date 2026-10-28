import { Channel } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { create } from "zustand";
import { ITEM_UPDATES_CHANGED_EVENT } from "../lib/appearanceWindow";
import { BackgroundTaskCancelledError } from "../lib/backgroundTaskCancel";
import { errorMessageFromUnknown } from "../lib/cdPlaybackFailure";
import { t } from "../lib/i18n";
import {
  isDownloadCancelled,
  ITEM_UPDATES_BULK_KEY,
} from "../lib/itemRegistry";
import {
  logRegistryInstallFailure,
  logRegistryInstallSuccess,
} from "../lib/packs/packInstallActivity";
import { refreshPackContributionStores } from "../lib/packs/refreshPackStores";
import { afterUiTransition } from "../lib/scheduling";
import { packUpdatesSettleOptions } from "../lib/toastPayloads";
import { AUTOMATIC_UPDATE_INTERVAL_MS } from "../lib/updater";
import {
  cancelItemDownload,
  checkItemUpdates,
  clearItemDownloadCancel,
  installItemFromRegistry,
  saveLibrarySettings,
} from "../lib/tauri";
import { isTauri } from "../lib/windowRole";
import { catalogItemName, type ItemUpdate } from "../types/itemRegistry";
import { useBackgroundTasksStore } from "./useBackgroundTasksStore";

export type ItemUpdateCheckReason = "automatic" | "manual";

interface ItemUpdatesState {
  /** Installed items with a newer, app-compatible version in a registry. */
  pendingUpdates: ItemUpdate[];
  status: "idle" | "checking" | "updating" | "error";
  lastError: string | null;
  automaticItemChecksEnabled: boolean;
  /** Sync from loaded library settings (default on until settings arrive). */
  applyAutomaticItemChecksEnabled: (enabled: boolean) => void;
  setAutomaticItemChecksEnabled: (enabled: boolean) => Promise<void>;
  /** Apply a pending list from another webview (cross-window event). */
  applyPendingUpdates: (pending: ItemUpdate[]) => void;
  checkForItemUpdates: (options?: {
    reason?: ItemUpdateCheckReason;
  }) => Promise<ItemUpdate[]>;
  /** Drop an item from pending after a successful single update. */
  removePendingUpdate: (effectiveId: string) => void;
  updateAllPendingItems: () => Promise<void>;
  startAutomaticItemUpdateChecks: () => () => void;
  pendingUpdateFor: (effectiveId: string) => ItemUpdate | null;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

async function broadcastPending(pending: ItemUpdate[]): Promise<void> {
  if (!isTauri()) return;
  try {
    await emit(ITEM_UPDATES_CHANGED_EVENT, pending);
  } catch {
    /* ignore cross-window emit failures */
  }
}

export const useItemUpdatesStore = create<ItemUpdatesState>((set, get) => ({
  pendingUpdates: [],
  status: "idle",
  lastError: null,
  automaticItemChecksEnabled: true,

  applyAutomaticItemChecksEnabled: (enabled) => {
    set({ automaticItemChecksEnabled: enabled });
  },

  setAutomaticItemChecksEnabled: async (enabled) => {
    set({ automaticItemChecksEnabled: enabled });
    try {
      await saveLibrarySettings({ automaticItemUpdateChecksEnabled: enabled });
    } catch (err) {
      const message = errorMessage(
        err,
        t("common:updates.error.savePreference"),
      );
      set({ status: "error", lastError: message });
      useBackgroundTasksStore.getState().showErrorToast({
        key: "item-updates-pref",
        label: t("common:updates.error.savePreference"),
        detail: message,
      });
      throw err;
    }
  },

  applyPendingUpdates: (pending) => {
    set({
      pendingUpdates: pending,
      lastError: null,
    });
  },

  pendingUpdateFor: (effectiveId) => {
    return (
      get().pendingUpdates.find((e) => e.effectiveId === effectiveId) ?? null
    );
  },

  removePendingUpdate: (effectiveId) => {
    const pending = get().pendingUpdates.filter(
      (e) => e.effectiveId !== effectiveId,
    );
    set({ pendingUpdates: pending });
    void broadcastPending(pending);
  },

  checkForItemUpdates: async ({ reason = "manual" } = {}) => {
    if (!isTauri()) return [];
    if (reason === "automatic" && !get().automaticItemChecksEnabled) {
      return get().pendingUpdates;
    }

    const previousPending = get().pendingUpdates;
    set({ status: "checking", lastError: null });

    try {
      const result = await checkItemUpdates();
      const errors = result.errors ?? [];
      // Nothing came back and a registry failed: keep what we knew rather than clearing it.
      if (result.updates.length === 0 && errors.length > 0) {
        set({
          status: previousPending.length > 0 ? "idle" : "error",
          lastError:
            errors.map((e) => e.error).join(" · ") ||
            t("toasts:packs.catalogFailed"),
          pendingUpdates: previousPending,
        });
        return previousPending;
      }

      set({
        pendingUpdates: result.updates,
        status: "idle",
        lastError: null,
      });
      void broadcastPending(result.updates);
      return result.updates;
    } catch (err) {
      const message = errorMessage(err, t("toasts:packs.catalogFailed"));
      set({
        status: previousPending.length > 0 ? "idle" : "error",
        lastError: message,
        pendingUpdates: previousPending,
      });
      return previousPending;
    }
  },

  updateAllPendingItems: async () => {
    if (!isTauri()) return;
    const queue = [...get().pendingUpdates];
    if (queue.length === 0) return;

    set({ status: "updating", lastError: null });

    await new Promise<void>((resolve) => {
      useBackgroundTasksStore.getState().runInBackground({
        key: ITEM_UPDATES_BULK_KEY,
        label: t("toasts:packs.updating"),
        cancellable: true,
        progressDisplay: "bar",
        run: async (ctx) => {
          let updated = 0;
          let failed = 0;
          const errors: string[] = [];
          const total = queue.length;

          try {
            for (let i = 0; i < queue.length; i++) {
              if (ctx.isCancelRequested()) {
                throw new BackgroundTaskCancelledError(
                  t("toasts:packs.downloadCancelled"),
                );
              }

              const entry = queue[i]!;
              const displayName = catalogItemName(entry);
              const v = entry.latest;
              ctx.setLabel(
                t("toasts:packs.downloading", { name: displayName }),
              );
              ctx.setProgress(i, total);

              await clearItemDownloadCancel();
              const onProgress = new Channel<{
                current: number;
                total: number;
              }>();
              onProgress.onmessage = ({ current, total: fileTotal }) => {
                if (fileTotal > 0) {
                  ctx.setProgress(i + current / fileTotal, total);
                }
              };

              try {
                if (ctx.isCancelRequested()) {
                  await cancelItemDownload();
                  throw new BackgroundTaskCancelledError(
                    t("toasts:packs.downloadCancelled"),
                  );
                }

                const result = await installItemFromRegistry({
                  registryUrl: entry.registryUrl,
                  publisherId: entry.publisherId,
                  itemType: entry.itemType,
                  id: entry.id,
                  version: v.version,
                  sha256: v.sha256,
                  sizeBytes: v.sizeBytes,
                  minAppVersion: v.minAppVersion ?? null,
                  onProgress,
                });

                logRegistryInstallSuccess({
                  result,
                  registryUrl: entry.registryUrl,
                  sha256: v.sha256,
                  sizeBytes: v.sizeBytes,
                  minAppVersion: v.minAppVersion,
                });
                updated += 1;
                get().removePendingUpdate(entry.effectiveId);
              } catch (err) {
                const message = errorMessageFromUnknown(err);
                if (
                  err instanceof BackgroundTaskCancelledError ||
                  isDownloadCancelled(message)
                ) {
                  throw new BackgroundTaskCancelledError(
                    t("toasts:packs.downloadCancelled"),
                  );
                }
                logRegistryInstallFailure({
                  err,
                  name: displayName,
                  registryUrl: entry.registryUrl,
                  publisherId: entry.publisherId,
                  itemType: entry.itemType,
                  id: entry.id,
                  version: v.version,
                  sha256: v.sha256,
                  sizeBytes: v.sizeBytes,
                  minAppVersion: v.minAppVersion,
                });
                failed += 1;
                errors.push(
                  `${displayName}: ${message || t("toasts:packs.updateFailedFallback")}`,
                );
              }
            }

            ctx.setProgress(total, total);
            const settle = packUpdatesSettleOptions({
              updated,
              failed,
              errors,
            });
            ctx.settleAs(settle);
            // settleAs applies after `run` returns — defer heavy refresh.
            void (async () => {
              try {
                await afterUiTransition();
                await refreshPackContributionStores();
              } catch (err) {
                console.error(
                  "Failed to refresh items after bulk update:",
                  err,
                );
              } finally {
                set({ status: "idle" });
                void get().checkForItemUpdates({ reason: "manual" });
                resolve();
              }
            })();
          } catch (err) {
            if (err instanceof BackgroundTaskCancelledError) {
              set({ status: "idle" });
              void get().checkForItemUpdates({ reason: "manual" });
              resolve();
              throw err;
            }
            const message = errorMessage(
              err,
              t("toasts:packs.updateFailedFallback"),
            );
            set({ status: "error", lastError: message });
            resolve();
            throw err;
          }
        },
      });
    });
  },

  startAutomaticItemUpdateChecks: () => {
    if (!isTauri()) return () => {};

    void get().checkForItemUpdates({ reason: "automatic" });

    const intervalId = globalThis.setInterval(() => {
      void get().checkForItemUpdates({ reason: "automatic" });
    }, AUTOMATIC_UPDATE_INTERVAL_MS);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  },
}));

/** After a single registry install, clear that item from pending and re-check. */
export async function refreshItemUpdatesAfterInstall(
  effectiveId?: string,
): Promise<void> {
  if (effectiveId) {
    useItemUpdatesStore.getState().removePendingUpdate(effectiveId);
  }
  await useItemUpdatesStore
    .getState()
    .checkForItemUpdates({ reason: "manual" });
}
