import {
  spiralCardInstallErrorPayload,
  spiralCardInstallSuccessPayload,
} from "./toastPayloads";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { useLicenseStore } from "../store/useLicenseStore";

export function showSpcardInstallSuccessToast(replaced: boolean) {
  useBackgroundTasksStore
    .getState()
    .showToast(spiralCardInstallSuccessPayload(replaced));
}

function showInstallErrorToast(err: unknown) {
  useBackgroundTasksStore
    .getState()
    .showErrorToast(spiralCardInstallErrorPayload(err));
}

/**
 * Ambient install (drop / OS open): confirm replace when a card is already
 * installed; otherwise install, toast, and open the Spiral Card modal.
 */
export async function requestSpcardInstall(path: string): Promise<void> {
  const license = useLicenseStore.getState();
  if (license.snapshot.installed) {
    license.setPendingReplacePath(path);
    return;
  }

  try {
    await license.installFromPath(path);
    showSpcardInstallSuccessToast(false);
  } catch (err) {
    showInstallErrorToast(err);
  }
}

/** Confirm overwrite after {@link requestSpcardInstall} queued a replace. */
export async function confirmPendingSpcardReplace(): Promise<void> {
  const license = useLicenseStore.getState();
  const path = license.pendingReplacePath;
  if (!path) return;

  try {
    await license.installFromPath(path);
    license.setPendingReplacePath(null);
    showSpcardInstallSuccessToast(true);
  } catch (err) {
    showInstallErrorToast(err);
    throw err;
  }
}

export function cancelPendingSpcardReplace(): void {
  useLicenseStore.getState().setPendingReplacePath(null);
}
