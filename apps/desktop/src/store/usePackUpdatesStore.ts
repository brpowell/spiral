import { Channel } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { create } from "zustand";
import { createOperationId } from "../lib/activityLog";
import { PACK_UPDATES_CHANGED_EVENT } from "../lib/appearanceWindow";
import { BackgroundTaskCancelledError } from "../lib/backgroundTaskCancel";
import { errorMessageFromUnknown } from "../lib/cdPlaybackFailure";
import { t } from "../lib/i18n";
import {
  catalogDisplayName,
  enrichPackCatalog,
  fetchPackCatalogSafe,
  PACK_UPDATES_BULK_KEY,
} from "../lib/packRegistry";
import {
  logPackInstallFailure,
  logPackInstallSuccess,
} from "../lib/packs/packInstallActivity";
import { refreshPackContributionStores } from "../lib/packs/refreshPackStores";
import { afterUiTransition } from "../lib/scheduling";
import { packUpdatesSettleOptions } from "../lib/toastPayloads";
import { AUTOMATIC_UPDATE_INTERVAL_MS } from "../lib/updater";
import {
  cancelPackDownload,
  clearPackDownloadCancel,
  installPackFromRegistry,
  saveLibrarySettings,
  type InstallPackResult,
} from "../lib/tauri";
import { isTauri } from "../lib/windowRole";
import type { CatalogPackEntry } from "../types/packRegistry";
import { useBackgroundTasksStore } from "./useBackgroundTasksStore";

export type PackUpdateCheckReason = "automatic" | "manual";

interface PackUpdatesState {
  pendingUpdates: CatalogPackEntry[];
  status: "idle" | "checking" | "updating" | "error";
  lastError: string | null;
  automaticPackChecksEnabled: boolean;
  /** Sync from loaded library settings (default on until settings arrive). */
  applyAutomaticPackChecksEnabled: (enabled: boolean) => void;
  setAutomaticPackChecksEnabled: (enabled: boolean) => Promise<void>;
  /** Apply a pending list from another webview (cross-window event). */
  applyPendingUpdates: (pending: CatalogPackEntry[]) => void;
  /**
   * Derive pending updates from an already-enriched catalog (e.g. Get more).
   * Keeps the Packs list in sync without a second registry round-trip.
   */
  syncPendingFromCatalog: (entries: CatalogPackEntry[]) => void;
  checkForPackUpdates: (options?: {
    reason?: PackUpdateCheckReason;
  }) => Promise<CatalogPackEntry[]>;
  /** Drop a pack identity from pending after a successful single update. */
  removePendingUpdate: (authorId: string, packId: string) => void;
  updateAllPendingPacks: () => Promise<void>;
  startAutomaticPackUpdateChecks: () => () => void;
  pendingUpdateFor: (
    authorId: string,
    packId: string,
  ) => CatalogPackEntry | null;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

function filterPending(entries: CatalogPackEntry[]): CatalogPackEntry[] {
  return entries.filter((e) => e.updateAvailable && e.meetsMinAppVersion);
}

async function broadcastPending(pending: CatalogPackEntry[]): Promise<void> {
  if (!isTauri()) return;
  try {
    await emit(PACK_UPDATES_CHANGED_EVENT, pending);
  } catch {
    /* ignore cross-window emit failures */
  }
}

export const usePackUpdatesStore = create<PackUpdatesState>((set, get) => ({
  pendingUpdates: [],
  status: "idle",
  lastError: null,
  automaticPackChecksEnabled: true,

  applyAutomaticPackChecksEnabled: (enabled) => {
    set({ automaticPackChecksEnabled: enabled });
  },

  setAutomaticPackChecksEnabled: async (enabled) => {
    set({ automaticPackChecksEnabled: enabled });
    try {
      await saveLibrarySettings({ automaticPackUpdateChecksEnabled: enabled });
    } catch (err) {
      const message = errorMessage(
        err,
        t("common:updates.error.savePreference"),
      );
      set({ status: "error", lastError: message });
      useBackgroundTasksStore.getState().showErrorToast({
        key: "pack-updates-pref",
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

  syncPendingFromCatalog: (entries) => {
    const pending = filterPending(entries);
    set({
      pendingUpdates: pending,
      lastError: null,
      status: "idle",
    });
    void broadcastPending(pending);
  },

  pendingUpdateFor: (authorId, packId) => {
    return (
      get().pendingUpdates.find(
        (e) => e.authorId === authorId && e.packId === packId,
      ) ?? null
    );
  },

  removePendingUpdate: (authorId, packId) => {
    const pending = get().pendingUpdates.filter(
      (e) => !(e.authorId === authorId && e.packId === packId),
    );
    set({ pendingUpdates: pending });
    void broadcastPending(pending);
  },

  checkForPackUpdates: async ({ reason = "manual" } = {}) => {
    if (!isTauri()) return [];
    if (reason === "automatic" && !get().automaticPackChecksEnabled) {
      return get().pendingUpdates;
    }

    const previousPending = get().pendingUpdates;
    set({ status: "checking", lastError: null });

    try {
      const result = await fetchPackCatalogSafe();
      if (!result.ok) {
        set({
          status: previousPending.length > 0 ? "idle" : "error",
          lastError: result.error,
          pendingUpdates: previousPending,
        });
        return previousPending;
      }

      const enriched = await enrichPackCatalog(result.catalog.packs, {
        resolvePreviews: false,
      });
      const pending = filterPending(enriched);
      set({
        pendingUpdates: pending,
        status: "idle",
        lastError: null,
      });
      void broadcastPending(pending);
      return pending;
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

  updateAllPendingPacks: async () => {
    if (!isTauri()) return;
    const queue = [...get().pendingUpdates];
    if (queue.length === 0) return;

    set({ status: "updating", lastError: null });

    await new Promise<void>((resolve) => {
      useBackgroundTasksStore.getState().runInBackground({
        key: PACK_UPDATES_BULK_KEY,
        label: t("toasts:packs.updating"),
        cancellable: true,
        progressDisplay: "bar",
        run: async (ctx) => {
          const operationId = createOperationId();
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
              const displayName = catalogDisplayName(entry);
              const v = entry.latestVersion;
              ctx.setLabel(
                t("toasts:packs.downloading", { name: displayName }),
              );
              ctx.setProgress(i, total);

              await clearPackDownloadCancel();
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
                  await cancelPackDownload();
                  throw new BackgroundTaskCancelledError(
                    t("toasts:packs.downloadCancelled"),
                  );
                }

                const result = await installPackFromRegistry({
                  registryUrl: entry.registryUrl,
                  authorId: entry.authorId,
                  packId: entry.packId,
                  version: v.version,
                  sha256: v.sha256,
                  sizeBytes: v.sizeBytes,
                  minAppVersion: v.minAppVersion ?? null,
                  onProgress,
                });

                logPackInstallSuccess({
                  operationId,
                  source: "registry",
                  result,
                  registryUrl: entry.registryUrl,
                  authorId: entry.authorId,
                  sha256: v.sha256,
                  sizeBytes: v.sizeBytes,
                  minAppVersion: v.minAppVersion,
                });
                updated += 1;
                get().removePendingUpdate(entry.authorId, entry.packId);
              } catch (err) {
                const message = errorMessageFromUnknown(err);
                if (
                  message === "Pack download cancelled" ||
                  /pack download cancelled/i.test(message)
                ) {
                  throw new BackgroundTaskCancelledError(
                    t("toasts:packs.downloadCancelled"),
                  );
                }
                logPackInstallFailure({
                  operationId,
                  source: "registry",
                  err,
                  name: displayName,
                  registryUrl: entry.registryUrl,
                  authorId: entry.authorId,
                  packId: entry.packId,
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
              operationId,
            });
            ctx.settleAs(settle);
            // settleAs applies after `run` returns — defer heavy refresh.
            void (async () => {
              try {
                await afterUiTransition();
                await refreshPackContributionStores();
              } catch (err) {
                console.error(
                  "Failed to refresh packs after bulk update:",
                  err,
                );
              } finally {
                set({ status: "idle" });
                void get().checkForPackUpdates({ reason: "manual" });
                resolve();
              }
            })();
          } catch (err) {
            if (err instanceof BackgroundTaskCancelledError) {
              set({ status: "idle" });
              void get().checkForPackUpdates({ reason: "manual" });
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

  startAutomaticPackUpdateChecks: () => {
    if (!isTauri()) return () => {};

    void get().checkForPackUpdates({ reason: "automatic" });

    const intervalId = globalThis.setInterval(() => {
      void get().checkForPackUpdates({ reason: "automatic" });
    }, AUTOMATIC_UPDATE_INTERVAL_MS);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  },
}));

/** After a single registry install, clear that pack from pending and re-check. */
export async function refreshPackUpdatesAfterInstall(
  result?: InstallPackResult | null,
  authorId?: string,
): Promise<void> {
  if (result && authorId) {
    usePackUpdatesStore.getState().removePendingUpdate(authorId, result.packId);
  }
  await usePackUpdatesStore
    .getState()
    .checkForPackUpdates({ reason: "manual" });
}
