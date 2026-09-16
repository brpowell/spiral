import {
  spiralCardInstallErrorPayload,
  spiralCardInstallSuccessPayload,
} from "./toastPayloads";
import { parseUserErrorCode } from "./userError";
import { redeemCardHandoff, type SpcardHandoff } from "./tauri";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import {
  useLicenseStore,
  type PendingSpcardReplace,
} from "../store/useLicenseStore";

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

function isExpiredInstallError(err: unknown): boolean {
  return parseUserErrorCode(err) === "license.installing.expired";
}

function handleAmbientInstallError(err: unknown) {
  if (isExpiredInstallError(err)) {
    // Grace / restore copy lives in the Spiral Card modal — no peer toast.
    useLicenseStore.getState().openRestoreSpiralCard();
    return;
  }
  showInstallErrorToast(err);
}

async function installPendingSource(
  source: PendingSpcardReplace,
): Promise<void> {
  const license = useLicenseStore.getState();
  if (source.kind === "path") {
    await license.installFromPath(source.path);
    return;
  }
  await license.installFromJson(source.json);
}

/**
 * Ambient install (drop / OS open): confirm replace when a card is already
 * installed; otherwise install, toast, and open the Spiral Card modal.
 */
export async function requestSpcardInstall(path: string): Promise<void> {
  return requestSpcardInstallSource({ kind: "path", path });
}

export async function requestSpcardInstallFromJson(
  json: string,
): Promise<void> {
  return requestSpcardInstallSource({ kind: "json", json });
}

async function requestSpcardInstallSource(
  source: PendingSpcardReplace,
): Promise<void> {
  const license = useLicenseStore.getState();
  if (license.snapshot.installed) {
    license.setPendingReplace(source);
    return;
  }

  try {
    await installPendingSource(source);
    showSpcardInstallSuccessToast(false);
  } catch (err) {
    handleAmbientInstallError(err);
  }
}

const seenHandoffTokens = new Set<string>();

/** Redeem a member-page token, then install the returned `.spcard`. */
export async function requestSpcardHandoff(
  handoff: SpcardHandoff,
): Promise<void> {
  if (seenHandoffTokens.has(handoff.token)) {
    return;
  }
  seenHandoffTokens.add(handoff.token);
  try {
    const json = await redeemCardHandoff(handoff.token, handoff.origin);
    await requestSpcardInstallFromJson(json);
  } catch (err) {
    showInstallErrorToast(err);
  }
}

/** Confirm overwrite after {@link requestSpcardInstall} queued a replace. */
export async function confirmPendingSpcardReplace(): Promise<void> {
  const license = useLicenseStore.getState();
  const source = license.pendingReplace;
  if (!source) return;

  try {
    await installPendingSource(source);
    license.setPendingReplace(null);
    showSpcardInstallSuccessToast(true);
  } catch (err) {
    handleAmbientInstallError(err);
    throw err;
  }
}

export function cancelPendingSpcardReplace(): void {
  useLicenseStore.getState().setPendingReplace(null);
}
