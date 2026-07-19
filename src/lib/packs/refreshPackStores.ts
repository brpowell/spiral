import {
  createWorkshopPack,
  deleteWorkshopContribution,
  deleteWorkshopPack,
  getPackScanWarnings,
  installPack,
  linkPackFolder,
  rollbackPack,
  setContributionHidden,
  uninstallPack,
  unlinkPack,
  updateLinkedPackMetadata,
  updateWorkshopPackMetadata,
  type DeleteWorkshopContributionResult,
  type InstallPackResult,
} from "../tauri";
import { emit } from "@tauri-apps/api/event";
import { useBackgroundTasksStore } from "../../store/useBackgroundTasksStore";
import { useSkinStore } from "../../store/useSkinStore";
import { useThemeStore } from "../../store/useThemeStore";
import { useVisualizerStore } from "../../store/useVisualizerStore";
import {
  LINKED_PACKS_CHANGED_EVENT,
  RELOAD_LINKED_PACKS_EVENT,
} from "../appearanceWindow";

function formatInvokeError(err: unknown, fallback: string): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

/** Reload theme / skin / visualizer lists after installing a pack. */
export async function refreshPackContributionStores(): Promise<void> {
  await Promise.all([
    useThemeStore.getState().loadThemes(),
    useSkinStore.getState().loadSkins(),
    useVisualizerStore.getState().loadVisualizers(),
  ]);
}

/**
 * File-picker install + store refresh + toast.
 * Returns the result, or `null` if cancelled or failed (errors are toasted).
 */
export async function importPackWithRefresh(): Promise<InstallPackResult | null> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    const result = await installPack();
    if (!result) return null;
    await refreshPackContributionStores();
    showToast({
      label: `Installed ${result.name} (${result.version})`,
      status: "success",
      key: "pack-install",
    });
    return result;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, "Failed to install pack"),
      key: "pack-install",
    });
    return null;
  }
}

/** Create an empty workshop pack + store refresh + toast. Returns the new packId. */
export async function createWorkshopPackWithRefresh(args: {
  name: string;
  description: string;
}): Promise<string | null> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    const packId = await createWorkshopPack(args);
    await refreshPackContributionStores();
    showToast({
      label: `Created ${args.name}`,
      status: "success",
      key: "pack-create",
    });
    return packId;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, "Failed to create pack"),
      key: "pack-create",
    });
    return null;
  }
}

/** Directory-picker link + store refresh + toast. */
export async function linkPackFolderWithRefresh(): Promise<string | null> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    const path = await linkPackFolder();
    if (!path) return null;
    await refreshPackContributionStores();
    await emit(LINKED_PACKS_CHANGED_EVENT);
    showToast({
      label: "Linked pack folder",
      status: "success",
      key: "pack-link",
    });
    return path;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, "Failed to link pack folder"),
      key: "pack-link",
    });
    return null;
  }
}

export async function unlinkPackWithRefresh(
  path: string,
  displayName: string,
): Promise<boolean> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    await unlinkPack(path);
    await refreshPackContributionStores();
    await emit(LINKED_PACKS_CHANGED_EVENT);
    showToast({
      label: `Unlinked ${displayName}`,
      status: "success",
      key: "pack-unlink",
    });
    return true;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, "Failed to unlink pack"),
      key: "pack-unlink",
    });
    return false;
  }
}

/** Re-scan packs (including linked) and surface scan warnings. */
export async function reloadLinkedPacksWithRefresh(): Promise<void> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    await refreshPackContributionStores();
    const warnings = await getPackScanWarnings();
    const linkedWarnings = warnings.filter((w) =>
      w.toLowerCase().includes("linked"),
    );
    if (linkedWarnings.length > 0) {
      showErrorToast({
        label: linkedWarnings[0],
        key: "pack-reload",
      });
    } else {
      showToast({
        label: "Reloaded linked packs",
        status: "success",
        key: "pack-reload",
      });
    }
    await emit(RELOAD_LINKED_PACKS_EVENT);
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, "Failed to reload linked packs"),
      key: "pack-reload",
    });
  }
}

export async function uninstallPackWithRefresh(
  packId: string,
  version: string,
  displayName: string,
): Promise<boolean> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    await uninstallPack(packId, version);
    await refreshPackContributionStores();
    showToast({
      label: `Uninstalled ${displayName} (${version})`,
      status: "success",
      key: "pack-uninstall",
    });
    return true;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, "Failed to uninstall pack"),
      key: "pack-uninstall",
    });
    return false;
  }
}

export async function rollbackPackWithRefresh(
  packId: string,
  version: string,
  displayName: string,
): Promise<boolean> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    const removed = await rollbackPack(packId, version);
    await refreshPackContributionStores();
    showToast({
      label: `Rolled back ${displayName} to ${version} (removed ${removed.join(", ")})`,
      status: "success",
      key: "pack-rollback",
    });
    return true;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, "Failed to roll back pack"),
      key: "pack-rollback",
    });
    return false;
  }
}

export async function setContributionHiddenWithRefresh(
  contributionId: string,
  hidden: boolean,
): Promise<boolean> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    await setContributionHidden(contributionId, hidden);
    await refreshPackContributionStores();
    showToast({
      label: hidden ? "Contribution hidden" : "Contribution shown",
      status: "success",
      key: "pack-hide",
    });
    return true;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(
        err,
        hidden ? "Failed to hide contribution" : "Failed to show contribution",
      ),
      key: "pack-hide",
    });
    return false;
  }
}

export async function updateWorkshopPackMetadataWithRefresh(
  packId: string,
  metadata: {
    packId: string;
    authorId: string;
    name: string;
    version: string;
    description: string;
  },
): Promise<string | null> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    const nextPackId = await updateWorkshopPackMetadata(packId, metadata);
    await refreshPackContributionStores();
    showToast({
      label: `Updated ${metadata.name}`,
      status: "success",
      key: "pack-edit",
    });
    return nextPackId;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, "Failed to update pack"),
      key: "pack-edit",
    });
    return null;
  }
}

export async function updateLinkedPackMetadataWithRefresh(
  packDir: string,
  metadata: {
    packId: string;
    authorId: string;
    name: string;
    version: string;
    description: string;
  },
): Promise<string | null> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    const nextPackId = await updateLinkedPackMetadata(packDir, metadata);
    await refreshPackContributionStores();
    showToast({
      label: `Updated ${metadata.name}`,
      status: "success",
      key: "pack-edit",
    });
    return nextPackId;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, "Failed to update pack"),
      key: "pack-edit",
    });
    return null;
  }
}

export async function deleteWorkshopPackWithRefresh(
  packId: string,
  displayName: string,
): Promise<boolean> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    await deleteWorkshopPack(packId);
    await refreshPackContributionStores();
    showToast({
      label: `Deleted ${displayName}`,
      status: "success",
      key: "pack-delete",
    });
    return true;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, "Failed to delete pack"),
      key: "pack-delete",
    });
    return false;
  }
}

export async function deleteWorkshopContributionWithRefresh(
  contributionId: string,
  displayName: string,
): Promise<DeleteWorkshopContributionResult | null> {
  const { showToast, showErrorToast } = useBackgroundTasksStore.getState();
  try {
    const result = await deleteWorkshopContribution(contributionId);
    await refreshPackContributionStores();
    showToast({
      label: result.packRemoved
        ? `Deleted ${displayName} and empty pack`
        : `Deleted ${displayName}`,
      status: "success",
      key: "pack-contrib-delete",
    });
    return result;
  } catch (err) {
    showErrorToast({
      label: formatInvokeError(err, "Failed to delete contribution"),
      key: "pack-contrib-delete",
    });
    return null;
  }
}
