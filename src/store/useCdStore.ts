import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  CD_DISC_CHANGED_EVENT,
  type CdDisc,
  type CdDiscChangedPayload,
  type CdDrive,
} from "../types/cd";
import {
  discNeedsCdText,
  mergeCdTextIntoDisc,
} from "../lib/cdTracks";
import {
  ejectCdDisc,
  getDiscCdText,
  getDiscInfo,
  listCdDrives,
  probeCdDrive,
} from "../lib/tauri";
import { useNavigationStore } from "./useNavigationStore";
import { usePlayerStore } from "./usePlayerStore";

interface CdState {
  drives: CdDrive[];
  discsByDriveId: Record<string, CdDisc | null | undefined>;
  loadingDriveIds: Set<string>;
  cdtextLoadingDriveIds: Set<string>;
  cdtextAttemptedDriveIds: Set<string>;
  ejectingDriveIds: Set<string>;
  initialized: boolean;
  refreshDrives: () => Promise<void>;
  probeDriveDisc: (drive: CdDrive) => Promise<void>;
  loadDisc: (
    driveId: string,
    options?: { force?: boolean },
  ) => Promise<CdDisc | null>;
  loadDiscCdText: (driveId: string) => Promise<void>;
  ejectDrive: (driveId: string) => Promise<void>;
  init: () => Promise<UnlistenFn>;
}

/** Coalesce concurrent loadDisc calls for the same drive. */
const inflightDiscLoads = new Map<string, Promise<CdDisc | null>>();
const inflightCdTextLoads = new Map<string, Promise<void>>();

/** Avoid flicker when drutil briefly loses disc presence during spin-up. */
const driveRemovalTimers = new Map<string, ReturnType<typeof setTimeout>>();
const absentVerifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DRIVE_REMOVAL_GRACE_MS = 3000;
/** Re-probe before dropping a drive we have already read — monitor false-negatives are common. */
const ABSENT_VERIFY_DELAY_MS = 2000;
const ABSENT_VERIFY_DELAY_ACTIVE_MS = 500;
/** Defer the first probe so library/settings IPC can finish first. */
const CD_STARTUP_DELAY_MS = 2000;
/** Ignore monitor absent signals briefly after a successful disc read. */
const DISC_LOAD_QUIET_MS = 20_000;
const ABSENT_VERIFY_ATTEMPTS_CACHED = 3;
const ABSENT_VERIFY_RETRY_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ignore monitor absent signals briefly after a successful disc read. */
const driveMonitorQuietUntil = new Map<string, number>();

function drivesWithDisc(drives: CdDrive[]): CdDrive[] {
  return drives.filter((drive) => drive.hasDisc);
}

function upsertDrive(drives: CdDrive[], drive: CdDrive): CdDrive[] {
  const index = drives.findIndex((entry) => entry.id === drive.id);
  if (index >= 0) {
    const next = [...drives];
    next[index] = drive;
    return next;
  }
  return [...drives, drive];
}

function cancelDriveRemoval(driveId: string): void {
  const timer = driveRemovalTimers.get(driveId);
  if (timer == null) return;
  clearTimeout(timer);
  driveRemovalTimers.delete(driveId);
}

function cancelAbsentVerification(driveId: string): void {
  const timer = absentVerifyTimers.get(driveId);
  if (timer == null) return;
  clearTimeout(timer);
  absentVerifyTimers.delete(driveId);
}

function isDrivePinned(driveId: string, state: CdState): boolean {
  if (state.loadingDriveIds.has(driveId)) return true;
  if (state.discsByDriveId[driveId] != null) return true;
  if (useNavigationStore.getState().cdDriveId === driveId) return true;
  return false;
}

function scheduleAbsentVerification(
  drive: CdDrive,
  set: (
    partial: Partial<CdState> | ((state: CdState) => Partial<CdState>),
  ) => void,
  get: () => CdState,
): void {
  if (absentVerifyTimers.has(drive.id) || driveRemovalTimers.has(drive.id))
    return;

  const delay =
    useNavigationStore.getState().cdDriveId === drive.id
      ? ABSENT_VERIFY_DELAY_ACTIVE_MS
      : ABSENT_VERIFY_DELAY_MS;

  absentVerifyTimers.set(
    drive.id,
    setTimeout(() => {
      absentVerifyTimers.delete(drive.id);
      void verifyDriveStillAbsent(drive, set, get);
    }, delay),
  );
}

function isDriveDiscLoadBusy(driveId: string, state: CdState): boolean {
  return (
    state.loadingDriveIds.has(driveId) ||
    inflightDiscLoads.has(driveId) ||
    (driveMonitorQuietUntil.get(driveId) ?? 0) > Date.now()
  );
}

async function verifyDriveStillAbsent(
  drive: CdDrive,
  set: (
    partial: Partial<CdState> | ((state: CdState) => Partial<CdState>),
  ) => void,
  get: () => CdState,
): Promise<void> {
  const state = get();
  if (!state.drives.some((entry) => entry.id === drive.id)) return;
  if (isDriveDiscLoadBusy(drive.id, state)) return;

  const hasCachedDisc = state.discsByDriveId[drive.id] != null;
  const attempts = hasCachedDisc ? ABSENT_VERIFY_ATTEMPTS_CACHED : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(ABSENT_VERIFY_RETRY_MS);
    }

    if (isDriveDiscLoadBusy(drive.id, get())) return;

    try {
      const hasDisc = await probeCdDrive(drive.id);
      if (hasDisc) {
        cancelDriveRemoval(drive.id);
        set((current) => ({
          drives: upsertDrive(current.drives, { ...drive, hasDisc: true }),
        }));
        return;
      }
    } catch (err) {
      console.error("verifyDriveStillAbsent failed:", err);
      return;
    }
  }

  // Confirmed eject — close the detail view and drop the drive immediately.
  driveMonitorQuietUntil.delete(drive.id);
  removeDriveNow(drive.id, set);
}

function removeDriveNow(
  driveId: string,
  set: (
    partial: Partial<CdState> | ((state: CdState) => Partial<CdState>),
  ) => void,
): void {
  cancelDriveRemoval(driveId);
  cancelAbsentVerification(driveId);

  if (useNavigationStore.getState().cdDriveId === driveId) {
    useNavigationStore.getState().closeCdDrive();
  }

  usePlayerStore.getState().stopCdPlaybackForDrive(driveId);

  set((state) => {
    const drives = state.drives.filter((drive) => drive.id !== driveId);
    const discsByDriveId = { ...state.discsByDriveId };
    delete discsByDriveId[driveId];
    const cdtextAttemptedDriveIds = new Set(state.cdtextAttemptedDriveIds);
    cdtextAttemptedDriveIds.delete(driveId);
    return { drives, discsByDriveId, cdtextAttemptedDriveIds };
  });
}

function scheduleDriveRemoval(
  driveId: string,
  set: (
    partial: Partial<CdState> | ((state: CdState) => Partial<CdState>),
  ) => void,
): void {
  if (driveRemovalTimers.has(driveId)) return;

  driveRemovalTimers.set(
    driveId,
    setTimeout(() => {
      driveRemovalTimers.delete(driveId);
      removeDriveNow(driveId, set);
    }, DRIVE_REMOVAL_GRACE_MS),
  );
}

function applyDrivesWithDisc(
  incoming: CdDrive[],
  set: (
    partial: Partial<CdState> | ((state: CdState) => Partial<CdState>),
  ) => void,
  get: () => CdState,
): void {
  const withDisc = drivesWithDisc(incoming);
  const incomingIds = new Set(withDisc.map((drive) => drive.id));

  for (const drive of withDisc) {
    cancelDriveRemoval(drive.id);
    cancelAbsentVerification(drive.id);
    scheduleDiscLoad(drive.id, get);
  }

  set((state) => {
    let drives = state.drives;
    for (const drive of withDisc) {
      drives = upsertDrive(drives, drive);
    }
    return { drives };
  });

  for (const drive of get().drives) {
    if (incomingIds.has(drive.id)) continue;

    const state = get();
    if (isDrivePinned(drive.id, state)) {
      if (!isDriveDiscLoadBusy(drive.id, state)) {
        scheduleAbsentVerification(drive, set, get);
      }
      continue;
    }

    scheduleDriveRemoval(drive.id, set);
  }
}

function scheduleDiscCdTextLoad(driveId: string, get: () => CdState): void {
  const disc = get().discsByDriveId[driveId];
  if (disc == null || !discNeedsCdText(disc)) return;
  void get().loadDiscCdText(driveId);
}

function scheduleDiscLoad(driveId: string, get: () => CdState): void {
  void get().loadDisc(driveId);
}

export const useCdStore = create<CdState>((set, get) => ({
  drives: [],
  discsByDriveId: {},
  loadingDriveIds: new Set(),
  cdtextLoadingDriveIds: new Set(),
  cdtextAttemptedDriveIds: new Set(),
  ejectingDriveIds: new Set(),
  initialized: false,

  refreshDrives: async () => {
    try {
      const drives = await listCdDrives();
      set({ initialized: true });

      for (const drive of drives) {
        void get().probeDriveDisc(drive);
      }
    } catch (err) {
      console.error("refreshDrives failed:", err);
      set({ initialized: true });
    }
  },

  probeDriveDisc: async (drive) => {
    try {
      const hasDisc = await probeCdDrive(drive.id);
      if (!hasDisc) return;

      cancelDriveRemoval(drive.id);
      cancelAbsentVerification(drive.id);
      set((state) => ({
        drives: upsertDrive(state.drives, { ...drive, hasDisc: true }),
      }));
      scheduleDiscLoad(drive.id, get);
    } catch (err) {
      console.error("probeDriveDisc failed:", err);
    }
  },

  loadDisc: async (driveId, options) => {
    const force = options?.force ?? false;
    if (!force && get().discsByDriveId[driveId] != null) {
      scheduleDiscCdTextLoad(driveId, get);
      return get().discsByDriveId[driveId] ?? null;
    }

    const inflight = inflightDiscLoads.get(driveId);
    if (inflight != null && !force) {
      return inflight;
    }

    const loadPromise = (async (): Promise<CdDisc | null> => {
      set((state) => ({
        loadingDriveIds: new Set(state.loadingDriveIds).add(driveId),
      }));

      try {
        const disc = await getDiscInfo(driveId);
        if (disc != null) {
          driveMonitorQuietUntil.set(driveId, Date.now() + DISC_LOAD_QUIET_MS);
        }
        set((state) => ({
          discsByDriveId: { ...state.discsByDriveId, [driveId]: disc },
        }));
        if (disc != null) {
          scheduleDiscCdTextLoad(driveId, get);
        }
        return disc;
      } catch (err) {
        console.error("loadDisc failed:", err);
        set((state) => ({
          discsByDriveId: { ...state.discsByDriveId, [driveId]: null },
        }));
        return null;
      } finally {
        inflightDiscLoads.delete(driveId);
        set((state) => {
          const loadingDriveIds = new Set(state.loadingDriveIds);
          loadingDriveIds.delete(driveId);
          return { loadingDriveIds };
        });
      }
    })();

    inflightDiscLoads.set(driveId, loadPromise);
    return loadPromise;
  },

  loadDiscCdText: async (driveId) => {
    const disc = get().discsByDriveId[driveId];
    if (disc == null || !discNeedsCdText(disc)) return;

    const inflight = inflightCdTextLoads.get(driveId);
    if (inflight != null) {
      return inflight;
    }

    const loadPromise = (async (): Promise<void> => {
      set((state) => ({
        cdtextLoadingDriveIds: new Set(state.cdtextLoadingDriveIds).add(driveId),
      }));

      try {
        driveMonitorQuietUntil.set(driveId, Date.now() + DISC_LOAD_QUIET_MS);
        const cdText = await getDiscCdText(driveId);
        if (cdText == null) return;

        set((state) => {
          const current = state.discsByDriveId[driveId];
          if (current == null) return {};
          return {
            discsByDriveId: {
              ...state.discsByDriveId,
              [driveId]: mergeCdTextIntoDisc(current, cdText),
            },
          };
        });
      } catch (err) {
        console.error("loadDiscCdText failed:", err);
      } finally {
        inflightCdTextLoads.delete(driveId);
        set((state) => {
          const cdtextLoadingDriveIds = new Set(state.cdtextLoadingDriveIds);
          cdtextLoadingDriveIds.delete(driveId);
          const cdtextAttemptedDriveIds = new Set(state.cdtextAttemptedDriveIds);
          cdtextAttemptedDriveIds.add(driveId);
          return { cdtextLoadingDriveIds, cdtextAttemptedDriveIds };
        });
      }
    })();

    inflightCdTextLoads.set(driveId, loadPromise);
    return loadPromise;
  },

  ejectDrive: async (driveId) => {
    if (get().ejectingDriveIds.has(driveId)) return;

    set((state) => ({
      ejectingDriveIds: new Set(state.ejectingDriveIds).add(driveId),
    }));

    try {
      usePlayerStore.getState().stopCdPlaybackForDrive(driveId);
      await ejectCdDisc(driveId);
      cancelDriveRemoval(driveId);
      cancelAbsentVerification(driveId);
      inflightDiscLoads.delete(driveId);
      inflightCdTextLoads.delete(driveId);
      driveMonitorQuietUntil.delete(driveId);
      removeDriveNow(driveId, set);
    } catch (err) {
      console.error("ejectDrive failed:", err);
      throw err;
    } finally {
      set((state) => {
        const ejectingDriveIds = new Set(state.ejectingDriveIds);
        ejectingDriveIds.delete(driveId);
        return { ejectingDriveIds };
      });
    }
  },

  init: async () => {
    const unlisten = await listen<CdDiscChangedPayload>(
      CD_DISC_CHANGED_EVENT,
      (event) => {
        applyDrivesWithDisc(event.payload.drives, set, get);
      },
    );

    window.setTimeout(() => {
      void get().refreshDrives();
    }, CD_STARTUP_DELAY_MS);

    return unlisten;
  },
}));

export function getCdDriveById(
  drives: CdDrive[],
  driveId: string,
): CdDrive | undefined {
  return drives.find((drive) => drive.id === driveId);
}
