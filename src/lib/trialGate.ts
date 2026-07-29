import { isTrackImporting } from "./pendingImportTrack";
import { useLicenseStore } from "../store/useLicenseStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { LicenseStatus } from "../types/license";
import type { Track } from "../types/track";

/** Mirrors `TRIAL_LIBRARY_TRACK_CAP` in `src-tauri/src/license/mod.rs`. */
export const TRIAL_LIBRARY_TRACK_CAP = 24;

/** Mirrors Rust `TRIAL_LIBRARY_CAP_ERROR_CODE`. */
export const TRIAL_LIBRARY_CAP_ERROR_CODE = "trial_library_cap";

export const TRIAL_PURCHASE_URL = "https://spiralpowered.com";

export const SUPPORT_EMAIL = "support@spiralpowered.com";

/**
 * Cap metric: persisted library track rows (`tracks` table / saved library
 * entries with id > 0). Playlist membership and pending import rows do not
 * count. Replace/upsert of an existing file path does not grow the count.
 */
export function licenseUnlocksLibrary(status: LicenseStatus): boolean {
  return (
    status === "provisional" ||
    status === "readyToFinalize" ||
    status === "licensed"
  );
}

/** Count saved library rows (exclude pending import placeholders). */
export function persistedLibraryTrackCount(library: Track[]): number {
  return library.filter((t) => t.id > 0 && !isTrackImporting(t)).length;
}

export function trialSlotsRemaining(
  library: Track[],
  status: LicenseStatus,
): number | null {
  if (licenseUnlocksLibrary(status)) return null;
  return Math.max(0, TRIAL_LIBRARY_TRACK_CAP - persistedLibraryTrackCount(library));
}

export function isTrialLibraryCapError(message: string): boolean {
  return message.includes(TRIAL_LIBRARY_CAP_ERROR_CODE);
}

/** Early UX gate: true when trial is at/over the library cap. */
export function isTrialLibraryAtCap(): boolean {
  const status = useLicenseStore.getState().snapshot.status;
  if (licenseUnlocksLibrary(status)) return false;
  const library = usePlayerStore.getState().library;
  return persistedLibraryTrackCount(library) >= TRIAL_LIBRARY_TRACK_CAP;
}

/** Spiral Card modal is the CTA — no banner or toast. */
export function notifyTrialLibraryCap(): void {
  useLicenseStore.getState().openSpiralCard();
}

/**
 * Block add-to-library when trial is at cap. Returns true if blocked.
 * Opens Spiral Card with a clear CTA.
 */
export function blockIfTrialLibraryAtCap(): boolean {
  if (!isTrialLibraryAtCap()) return false;
  notifyTrialLibraryCap();
  return true;
}

/**
 * For batch adds that need N new slots (e.g. convert add_new). Returns true
 * and notifies when trial cannot fit the whole batch.
 */
export function blockIfTrialCannotFit(newTrackCount: number): boolean {
  const status = useLicenseStore.getState().snapshot.status;
  if (licenseUnlocksLibrary(status)) return false;
  if (newTrackCount <= 0) return false;

  const remaining = trialSlotsRemaining(
    usePlayerStore.getState().library,
    status,
  );
  if (remaining == null) return false;
  if (remaining === 0 || newTrackCount > remaining) {
    notifyTrialLibraryCap();
    return true;
  }
  return false;
}
