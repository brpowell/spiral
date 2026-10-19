import { emit } from "@tauri-apps/api/event";
import { createOperationId } from "../activityLog";
import {
  LINKED_PACKS_CHANGED_EVENT,
  RELOAD_LINKED_PACKS_EVENT,
} from "../appearanceWindow";
import { t } from "../i18n";
import {
  deleteWorkshopItem,
  exportItem,
  getItemScanWarnings,
  installItem,
  linkItemFolder,
  uninstallItem,
  unlinkItem,
  updateItemMetadata,
  type ExportItemResult,
  type InstallItemResult,
} from "../tauri";
import { invalidateAllPackChangelogCaches } from "../packs/packChangelogCache";
import { invalidateAllPackReadmeCaches } from "../packs/packReadmeCache";
import {
  clearPackAuthorSkinSettings,
  type ClearableSkinSetting,
} from "../packs/packSkinSettings";
import { refreshPackContributionStores } from "../packs/refreshPackStores";
import {
  logItemInstallSuccess,
  logItemInstallFailure,
} from "../packs/packInstallActivity";
import { useBackgroundTasksStore } from "../../store/useBackgroundTasksStore";

function formatInvokeError(err: unknown, fallback: string): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

/**
 * File-picker install + store refresh + toast.
 * Returns the result, or `null` if cancelled or failed (errors are toasted).
 */
export async function importItemWithRefresh(): Promise<InstallItemResult | null> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  const operationId = createOperationId();
  try {
    const result = await installItem();
    if (!result) return null;
    await refreshPackContributionStores();
    logItemInstallSuccess({ operationId, result });
    showToast({
      label: result.replacedVersion
        ? t("toasts:items.reinstalled", {
            name: result.name,
            version: result.version,
          })
        : t("toasts:items.installed", {
            name: result.name,
            version: result.version,
          }),
      status: "success",
      key: "item-install",
    });
    return result;
  } catch (err) {
    logItemInstallFailure({ operationId, err });
    showErrorToast({
      label: formatInvokeError(err, t("toasts:items.installFailed")),
      detail: t("toasts:items.installFailedDetail"),
      logLink: { operationId },
      key: "item-install",
    });
    return null;
  }
}

/** Directory-picker link + store refresh + toast. */
export async function linkItemFolderWithRefresh(): Promise<string | null> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    const path = await linkItemFolder();
    if (!path) return null;
    await refreshPackContributionStores();
    await emit(LINKED_PACKS_CHANGED_EVENT);
    showToast({
      label: t("toasts:items.linked"),
      status: "success",
      key: "item-link",
    });
    return path;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, t("toasts:items.linkFailed")),
      key: "item-link",
    });
    return null;
  }
}

export async function unlinkItemWithRefresh(
  path: string,
  displayName: string,
): Promise<boolean> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    await unlinkItem(path);
    await refreshPackContributionStores();
    await emit(LINKED_PACKS_CHANGED_EVENT);
    showToast({
      label: t("toasts:items.unlinked", { name: displayName }),
      status: "success",
      key: "item-unlink",
    });
    return true;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, t("toasts:items.unlinkFailed")),
      key: "item-unlink",
    });
    return false;
  }
}

/** Re-scan items (including linked) and surface scan warnings. */
export async function reloadLinkedItemsWithRefresh(): Promise<void> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    await refreshPackContributionStores();
    // Linked folders are not file-watched; drop doc caches so Studio re-reads disk.
    invalidateAllPackReadmeCaches();
    invalidateAllPackChangelogCaches();
    const warnings = await getItemScanWarnings();
    const linkedWarnings = warnings.filter((w) =>
      w.toLowerCase().includes("linked"),
    );
    if (linkedWarnings.length > 0) {
      showErrorToast({ label: linkedWarnings[0], key: "item-reload" });
    } else {
      showToast({
        label: t("toasts:items.reloaded"),
        status: "success",
        key: "item-reload",
      });
    }
    await emit(RELOAD_LINKED_PACKS_EVENT);
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, t("toasts:items.reloadFailed")),
      key: "item-reload",
    });
  }
}

export async function uninstallItemWithRefresh(
  itemId: string,
  displayName: string,
  clearSkinSettings: readonly ClearableSkinSetting[] = [],
): Promise<boolean> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    if (clearSkinSettings.length > 0) {
      await clearPackAuthorSkinSettings(clearSkinSettings);
    }
    await uninstallItem(itemId);
    await refreshPackContributionStores();
    showToast({
      label: t("toasts:items.uninstalled", { name: displayName }),
      status: "success",
      key: "item-uninstall",
    });
    return true;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, t("toasts:items.uninstallFailed")),
      key: "item-uninstall",
    });
    return false;
  }
}

export async function deleteWorkshopItemWithRefresh(
  itemId: string,
  displayName: string,
): Promise<boolean> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    await deleteWorkshopItem(itemId);
    await refreshPackContributionStores();
    showToast({
      label: t("toasts:items.deleted", { name: displayName }),
      status: "success",
      key: "item-delete",
    });
    return true;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, t("toasts:items.deleteFailed")),
      key: "item-delete",
    });
    return false;
  }
}

/** Returns the item's effective id after the update, or `null` on failure. */
export async function updateItemMetadataWithRefresh(
  itemId: string,
  metadata: {
    id: string;
    publisherId: string;
    name: string;
    version: string;
    description: string;
  },
): Promise<string | null> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    const nextId = await updateItemMetadata(itemId, metadata);
    await refreshPackContributionStores();
    showToast({
      label: t("toasts:items.updated", { name: metadata.name }),
      status: "success",
      key: "item-edit",
    });
    return nextId;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, t("toasts:items.updateFailed")),
      key: "item-edit",
    });
    return null;
  }
}

/**
 * Export an authoring item to a `.spk` (the backend opens the save dialog).
 * Returns the result, or `null` when the dialog was cancelled or the export failed
 * (failures are toasted).
 */
export async function exportItemWithToast(
  itemId: string,
  metadata: { name: string; version: string; description: string },
): Promise<ExportItemResult | null> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    const result = await exportItem({ itemId, ...metadata });
    if (!result) return null;
    showToast({
      label: t("toasts:items.exported", {
        name: metadata.name,
        version: result.version,
      }),
      status: "success",
      key: "item-export",
    });
    return result;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, t("toasts:items.exportFailed")),
      key: "item-export",
    });
    return null;
  }
}
