import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { useLicenseStore } from "../store/useLicenseStore";

function formatInstallError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return "Failed to install Spiral Card";
}

export function showSpcardInstallSuccessToast(replaced: boolean) {
  useBackgroundTasksStore.getState().showToast({
    key: "spiral-card-install",
    label: replaced ? "Spiral Card replaced" : "Spiral Card installed",
  });
}

function showInstallErrorToast(err: unknown) {
  useBackgroundTasksStore.getState().showErrorToast({
    key: "spiral-card-install",
    label: formatInstallError(err),
  });
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
