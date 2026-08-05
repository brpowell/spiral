import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  CD_DISC_CHANGED_EVENT,
  type CdDisc,
  type CdDiscChangedPayload,
  type CdDrive,
  type DiscMetadata,
  type DiscMetadataLookup,
} from "../types/cd";
import type { ActivityLogContext } from "../types/activityLog";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";
import {
  discNeedsCdText,
  discTocTracks,
  mergeCdTextIntoDisc,
} from "../lib/cdTracks";
import { discFromActivePlayback } from "../lib/cdActivePlaybackDisc";
import { isCdImportBlockingPlayback } from "../lib/cdImportGuard";
import {
  startCdHeroArtFetch,
  startCdMetadataFetch,
} from "../lib/cdMetadataFetch";
import { syncCdHeroArtToPlayback } from "../lib/cdPlaybackArt";
import { logActivity } from "../lib/activityLog";
import { isNetworkLikelyAvailable } from "../lib/network";
import {
  ejectCdDisc,
  getDiscCdText,
  getDiscInfo,
  listCdDrives,
  lookupDiscMetadata,
  peekDiscMetadataCache,
  probeCdDrive,
  saveDiscMetadataPreference,
} from "../lib/tauri";
import { useLibrarySettingsStore } from "./useLibrarySettingsStore";
import { useNavigationStore } from "./useNavigationStore";
import { usePlayerStore } from "./usePlayerStore";

interface CdState {
  drives: CdDrive[];
  discsByDriveId: Record<string, CdDisc | null | undefined>;
  metadataByDriveId: Record<string, DiscMetadata | undefined>;
  metadataCandidatesByDriveId: Record<string, DiscMetadata[]>;
  metadataFetchedDiscIdByDriveId: Record<string, string | undefined>;
  metadataPickDriveId: string | null;
  metadataFetchPromptDriveId: string | null;
  metadataFetchPromptQueue: string[];
  heroArtByDriveId: Record<string, string | undefined>;
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
  loadDiscMetadata: (
    driveId: string,
    options?: { force?: boolean; logContext?: ActivityLogContext },
  ) => Promise<void>;
  selectDiscMetadata: (driveId: string, metadata: DiscMetadata) => void;
  dismissDiscMetadataPick: (driveId: string) => void;
  confirmMetadataFetch: (driveId: string, remember: boolean) => void;
  cancelMetadataFetch: (driveId: string, remember: boolean) => void;
  resetMetadataCacheState: () => void;
  setHeroArt: (driveId: string, artPath: string | null) => void;
  ejectDrive: (driveId: string) => Promise<void>;
  init: () => Promise<UnlistenFn>;
}

function patchFromMetadataLookup(
  driveId: string,
  discId: string | undefined,
  lookup: DiscMetadataLookup,
  state: CdState,
): Partial<CdState> {
  const candidates = lookup.candidates;
  const selected =
    lookup.preferred ?? (candidates.length === 1 ? candidates[0] : undefined);

  const patch: Partial<CdState> = {
    metadataCandidatesByDriveId: {
      ...state.metadataCandidatesByDriveId,
      [driveId]: candidates,
    },
    metadataFetchedDiscIdByDriveId: {
      ...state.metadataFetchedDiscIdByDriveId,
      [driveId]: discId ?? lookup.discId ?? undefined,
    },
  };

  if (selected) {
    patch.metadataByDriveId = {
      ...state.metadataByDriveId,
      [driveId]: selected,
    };
    if (state.metadataPickDriveId === driveId) {
      patch.metadataPickDriveId = null;
    }
    return patch;
  }

  if (candidates.length > 1 && state.metadataByDriveId[driveId] == null) {
    patch.metadataPickDriveId = driveId;
  }

  return patch;
}

/** Coalesce concurrent loadDisc calls for the same drive. */
const inflightDiscLoads = new Map<string, Promise<CdDisc | null>>();
const inflightCdTextLoads = new Map<string, Promise<void>>();
const inflightMetadataPeeks = new Map<string, Promise<void>>();

function markMetadataFetched(
  driveId: string,
  discId: string | undefined,
  state: CdState,
): Partial<CdState> {
  return {
    metadataFetchedDiscIdByDriveId: {
      ...state.metadataFetchedDiscIdByDriveId,
      [driveId]: discId,
    },
  };
}

function dequeueMetadataFetchPrompt(state: CdState): Partial<CdState> {
  const [next, ...rest] = state.metadataFetchPromptQueue;
  return {
    metadataFetchPromptDriveId: next ?? null,
    metadataFetchPromptQueue: rest,
  };
}

function enqueueMetadataFetchPrompt(
  driveId: string,
  state: CdState,
): Partial<CdState> {
  if (state.metadataFetchPromptDriveId === driveId) {
    return {};
  }
  if (state.metadataFetchPromptDriveId != null) {
    if (state.metadataFetchPromptQueue.includes(driveId)) {
      return {};
    }
    return {
      metadataFetchPromptQueue: [...state.metadataFetchPromptQueue, driveId],
    };
  }
  return { metadataFetchPromptDriveId: driveId };
}

async function resolveMetadataFetchMode(): Promise<"ask" | "always" | "never"> {
  const settings =
    useLibrarySettingsStore.getState().settings ??
    (await useLibrarySettingsStore.getState().loadSettings());
  const mode = settings.cdMetadataFetchMode;
  if (mode === "always" || mode === "never") return mode;
  return "ask";
}

function finishMetadataFetchPrompt(
  driveId: string,
  remember: boolean,
  rememberedMode: "always" | "never",
  startFetch: boolean,
  get: () => CdState,
  set: (
    partial: Partial<CdState> | ((state: CdState) => Partial<CdState>),
  ) => void,
): void {
  const discId = get().discsByDriveId[driveId]?.discId ?? undefined;

  set((state) => ({
    ...markMetadataFetched(driveId, discId, state),
    ...dequeueMetadataFetchPrompt(state),
  }));

  if (remember) {
    void useLibrarySettingsStore
      .getState()
      .saveLibrarySettings({ cdMetadataFetchMode: rememberedMode });
  }

  if (startFetch) {
    startCdMetadataFetch(driveId);
  }
}

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

  const loading =
    state.loadingDriveIds.has(drive.id) || inflightDiscLoads.has(drive.id);
  const quietOnly =
    !loading && (driveMonitorQuietUntil.get(drive.id) ?? 0) > Date.now();

  // In-flight TOC/CD-Text: keep the absent signal alive until reads finish.
  if (loading) {
    scheduleAbsentVerification(drive, set, get);
    return;
  }

  // Quiet window ignores remount flicker; a vanished device is not flicker.
  if (quietOnly) {
    try {
      const listed = await listCdDrives();
      if (!listed.some((entry) => entry.id === drive.id)) {
        driveMonitorQuietUntil.delete(drive.id);
        removeDriveNow(drive.id, set);
        return;
      }
    } catch (err) {
      console.warn("verifyDriveStillAbsent: list during quiet failed:", err);
    }
    scheduleAbsentVerification(drive, set, get);
    return;
  }

  const hasCachedDisc = state.discsByDriveId[drive.id] != null;
  const attempts = hasCachedDisc ? ABSENT_VERIFY_ATTEMPTS_CACHED : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(ABSENT_VERIFY_RETRY_MS);
    }

    if (isDriveDiscLoadBusy(drive.id, get())) {
      scheduleAbsentVerification(drive, set, get);
      return;
    }

    try {
      const hasDisc = await probeCdDrive(drive.id);
      if (hasDisc) {
        // Cross-check enumeration — stale positive cache can outlive a yank.
        const listed = await listCdDrives();
        if (!listed.some((entry) => entry.id === drive.id)) {
          break;
        }
        cancelDriveRemoval(drive.id);
        set((current) => ({
          drives: upsertDrive(current.drives, { ...drive, hasDisc: true }),
        }));
        return;
      }
    } catch (err) {
      // Probe IPC failure on a missing drive — treat as confirmed absence.
      console.warn(
        "verifyDriveStillAbsent: probe failed, removing drive:",
        err,
      );
      break;
    }
  }

  driveMonitorQuietUntil.delete(drive.id);
  removeDriveNow(drive.id, set);
}

function clearDriveDiscDerivedState(
  driveId: string,
  state: CdState,
): Partial<CdState> {
  const discsByDriveId = { ...state.discsByDriveId };
  delete discsByDriveId[driveId];
  const metadataByDriveId = { ...state.metadataByDriveId };
  delete metadataByDriveId[driveId];
  const metadataCandidatesByDriveId = { ...state.metadataCandidatesByDriveId };
  delete metadataCandidatesByDriveId[driveId];
  const metadataFetchedDiscIdByDriveId = {
    ...state.metadataFetchedDiscIdByDriveId,
  };
  delete metadataFetchedDiscIdByDriveId[driveId];
  const metadataPickDriveId =
    state.metadataPickDriveId === driveId ? null : state.metadataPickDriveId;
  const metadataFetchPromptDriveId =
    state.metadataFetchPromptDriveId === driveId
      ? null
      : state.metadataFetchPromptDriveId;
  const metadataFetchPromptQueue = state.metadataFetchPromptQueue.filter(
    (id) => id !== driveId,
  );
  const heroArtByDriveId = { ...state.heroArtByDriveId };
  delete heroArtByDriveId[driveId];
  const cdtextAttemptedDriveIds = new Set(state.cdtextAttemptedDriveIds);
  cdtextAttemptedDriveIds.delete(driveId);
  const cdtextLoadingDriveIds = new Set(state.cdtextLoadingDriveIds);
  cdtextLoadingDriveIds.delete(driveId);
  return {
    discsByDriveId,
    metadataByDriveId,
    metadataCandidatesByDriveId,
    metadataFetchedDiscIdByDriveId,
    metadataPickDriveId,
    metadataFetchPromptDriveId,
    metadataFetchPromptQueue,
    heroArtByDriveId,
    cdtextAttemptedDriveIds,
    cdtextLoadingDriveIds,
  };
}

function cancelDriveDiscInflight(driveId: string): void {
  inflightDiscLoads.delete(driveId);
  inflightCdTextLoads.delete(driveId);
  inflightMetadataLoads.delete(driveId);
  inflightMetadataPeeks.delete(driveId);
}

function shouldDeferDriveDiscRead(driveId: string): boolean {
  const { cdDriveId, currentPlayable, playbackState } =
    usePlayerStore.getState();
  const playbackActive =
    playbackState !== "stopped" &&
    (cdDriveId === driveId ||
      (currentPlayable?.type === "cd" && currentPlayable.driveId === driveId));

  return playbackActive || isCdImportBlockingPlayback(driveId);
}

function stageDiscFromActivePlayback(
  driveId: string,
  set: (
    partial: Partial<CdState> | ((state: CdState) => Partial<CdState>),
  ) => void,
): CdDisc | null {
  const disc = discFromActivePlayback(driveId);
  if (disc == null) return null;
  set((state) => ({
    discsByDriveId: { ...state.discsByDriveId, [driveId]: disc },
  }));
  return disc;
}

function refreshDriveDisc(
  driveId: string,
  set: (
    partial: Partial<CdState> | ((state: CdState) => Partial<CdState>),
  ) => void,
  get: () => CdState,
): void {
  if (shouldDeferDriveDiscRead(driveId)) return;

  usePlayerStore.getState().stopCdPlaybackForDrive(driveId);
  cancelDriveDiscInflight(driveId);
  set((state) => clearDriveDiscDerivedState(driveId, state));
  void get().loadDisc(driveId, { force: true });
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

  set((state) => ({
    drives: state.drives.filter((drive) => drive.id !== driveId),
    ...clearDriveDiscDerivedState(driveId, state),
  }));
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
  const prevDrivesById = new Map(
    get().drives.map((drive) => [drive.id, drive]),
  );

  for (const drive of withDisc) {
    cancelDriveRemoval(drive.id);
    cancelAbsentVerification(drive.id);
    const discAlreadyLoaded = get().discsByDriveId[drive.id] !== undefined;
    const hadDisc = prevDrivesById.get(drive.id)?.hasDisc ?? false;

    if (!discAlreadyLoaded) {
      scheduleDiscLoad(drive.id, get);
    } else if (!hadDisc) {
      refreshDriveDisc(drive.id, set, get);
    }
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
      // Reschedule while quiet/loading — don't drop the absent signal.
      scheduleAbsentVerification(drive, set, get);
      continue;
    }

    scheduleDriveRemoval(drive.id, set);
  }
}

const inflightMetadataLoads = new Map<string, Promise<void>>();

async function maybeLoadDiscMetadata(
  driveId: string,
  get: () => CdState,
): Promise<void> {
  const disc = get().discsByDriveId[driveId];
  if (disc == null) return;

  const discId = disc.discId ?? undefined;
  if (get().metadataByDriveId[driveId] != null) {
    startCdHeroArtFetch(driveId);
    return;
  }
  if (
    discId != null &&
    get().metadataFetchedDiscIdByDriveId[driveId] === discId
  ) {
    return;
  }

  const inflight = inflightMetadataPeeks.get(driveId);
  if (inflight != null) {
    return inflight;
  }

  const markFetched = () =>
    useCdStore.setState((state) => markMetadataFetched(driveId, discId, state));

  const peekPromise = (async (): Promise<void> => {
    const logContext: ActivityLogContext = { driveId, discId };
    try {
      const peek = await peekDiscMetadataCache(
        driveId,
        discTocTracks(disc),
        logContext,
      );
      useCdStore.setState((state) =>
        patchFromMetadataLookup(driveId, discId, peek.lookup, state),
      );

      if (!peek.needsNetworkFetch) {
        logActivity({
          level: "info",
          domain: ACTIVITY_LOG_DOMAINS.musicbrainz,
          message: "Metadata served from cache on disc load",
          context: logContext,
          details: {
            candidateCount: peek.lookup.candidates.length,
          },
        });
        markFetched();
        if (useCdStore.getState().metadataByDriveId[driveId] != null) {
          startCdHeroArtFetch(driveId);
        }
        return;
      }

      if (!isNetworkLikelyAvailable()) {
        logActivity({
          level: "warn",
          domain: ACTIVITY_LOG_DOMAINS.musicbrainz,
          message: "Skipped metadata network fetch: network unavailable",
          context: logContext,
        });
        markFetched();
        return;
      }

      const mode = await resolveMetadataFetchMode();
      if (mode === "never") {
        logActivity({
          level: "info",
          domain: ACTIVITY_LOG_DOMAINS.musicbrainz,
          message: "Skipped metadata fetch: user preference is never",
          context: logContext,
        });
        markFetched();
        return;
      }
      if (mode === "always") {
        logActivity({
          level: "info",
          domain: ACTIVITY_LOG_DOMAINS.musicbrainz,
          message: "Starting automatic metadata fetch",
          context: logContext,
        });
        markFetched();
        startCdMetadataFetch(driveId);
        return;
      }

      logActivity({
        level: "info",
        domain: ACTIVITY_LOG_DOMAINS.musicbrainz,
        message: "Prompting user to fetch metadata",
        context: logContext,
      });
      useCdStore.setState((state) =>
        enqueueMetadataFetchPrompt(driveId, state),
      );
    } catch (err) {
      logActivity({
        level: "error",
        domain: ACTIVITY_LOG_DOMAINS.musicbrainz,
        message: "Metadata cache peek failed",
        context: logContext,
        details: {
          error: err instanceof Error ? err.message : String(err),
        },
      });
      console.error("maybeLoadDiscMetadata failed:", err);
    }
  })();

  inflightMetadataPeeks.set(driveId, peekPromise);
  try {
    await peekPromise;
  } finally {
    inflightMetadataPeeks.delete(driveId);
  }
}

function scheduleDiscCdTextLoad(driveId: string, get: () => CdState): void {
  const state = get();
  const disc = state.discsByDriveId[driveId];
  if (disc == null || !discNeedsCdText(disc)) return;
  if (state.cdtextAttemptedDriveIds.has(driveId)) return;
  if (shouldDeferDriveDiscRead(driveId)) return;
  void get().loadDiscCdText(driveId);
}

function scheduleDiscLoad(driveId: string, get: () => CdState): void {
  void get().loadDisc(driveId);
}

export const useCdStore = create<CdState>((set, get) => ({
  drives: [],
  discsByDriveId: {},
  metadataByDriveId: {},
  metadataCandidatesByDriveId: {},
  metadataFetchedDiscIdByDriveId: {},
  metadataPickDriveId: null,
  metadataFetchPromptDriveId: null,
  metadataFetchPromptQueue: [],
  heroArtByDriveId: {},
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
      if (!shouldDeferDriveDiscRead(driveId)) {
        scheduleDiscCdTextLoad(driveId, get);
      }
      void maybeLoadDiscMetadata(driveId, get);
      return get().discsByDriveId[driveId] ?? null;
    }

    if (!force && shouldDeferDriveDiscRead(driveId)) {
      const cached = get().discsByDriveId[driveId];
      if (cached != null) return cached;
      return stageDiscFromActivePlayback(driveId, set);
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
        const previous = get().discsByDriveId[driveId];
        const disc = await getDiscInfo(driveId);
        if (
          previous?.discId &&
          disc?.discId &&
          previous.discId !== disc.discId
        ) {
          usePlayerStore.getState().stopCdPlaybackForDrive(driveId);
          set((state) => clearDriveDiscDerivedState(driveId, state));
        }
        if (disc != null) {
          driveMonitorQuietUntil.set(driveId, Date.now() + DISC_LOAD_QUIET_MS);
        }
        set((state) => ({
          discsByDriveId: { ...state.discsByDriveId, [driveId]: disc },
        }));
        if (disc != null) {
          scheduleDiscCdTextLoad(driveId, get);
          void maybeLoadDiscMetadata(driveId, get);
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
    const state = get();
    const disc = state.discsByDriveId[driveId];
    if (disc == null || !discNeedsCdText(disc)) return;
    if (state.cdtextAttemptedDriveIds.has(driveId)) return;
    if (shouldDeferDriveDiscRead(driveId)) return;

    const inflight = inflightCdTextLoads.get(driveId);
    if (inflight != null) {
      return inflight;
    }

    const loadPromise = (async (): Promise<void> => {
      set((state) => ({
        cdtextLoadingDriveIds: new Set(state.cdtextLoadingDriveIds).add(
          driveId,
        ),
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
          const cdtextAttemptedDriveIds = new Set(
            state.cdtextAttemptedDriveIds,
          );
          cdtextAttemptedDriveIds.add(driveId);
          return { cdtextLoadingDriveIds, cdtextAttemptedDriveIds };
        });
      }
    })();

    inflightCdTextLoads.set(driveId, loadPromise);
    return loadPromise;
  },

  loadDiscMetadata: async (driveId, options) => {
    const force = options?.force ?? false;
    const disc = get().discsByDriveId[driveId];
    if (disc == null) return;

    const discId = disc.discId ?? undefined;
    if (!force && get().metadataByDriveId[driveId] != null) return;
    if (
      !force &&
      discId != null &&
      get().metadataFetchedDiscIdByDriveId[driveId] === discId
    ) {
      return;
    }

    const inflight = inflightMetadataLoads.get(driveId);
    if (inflight != null && !force) {
      return inflight;
    }

    const loadPromise = (async (): Promise<void> => {
      try {
        const lookup = await lookupDiscMetadata(driveId, discTocTracks(disc), {
          force: options?.force,
          logContext: options?.logContext ?? { driveId, discId },
        });
        set((state) => patchFromMetadataLookup(driveId, discId, lookup, state));
        set((state) => markMetadataFetched(driveId, discId, state));
      } catch (err) {
        logActivity({
          level: "error",
          domain: ACTIVITY_LOG_DOMAINS.musicbrainz,
          message: "Disc metadata lookup failed",
          operationId: options?.logContext?.operationId,
          context: options?.logContext ?? { driveId, discId },
          details: {
            error: err instanceof Error ? err.message : String(err),
          },
        });
        console.error("loadDiscMetadata failed:", err);
      } finally {
        inflightMetadataLoads.delete(driveId);
      }
    })();

    inflightMetadataLoads.set(driveId, loadPromise);
    return loadPromise;
  },

  selectDiscMetadata: (driveId, metadata) => {
    set((state) => ({
      metadataByDriveId: { ...state.metadataByDriveId, [driveId]: metadata },
      metadataPickDriveId:
        state.metadataPickDriveId === driveId
          ? null
          : state.metadataPickDriveId,
    }));

    const disc = get().discsByDriveId[driveId];
    if (disc?.discId && metadata.releaseMbid) {
      void saveDiscMetadataPreference(disc.discId, metadata.releaseMbid).catch(
        (err) => {
          console.error("saveDiscMetadataPreference failed:", err);
        },
      );
    }

    get().setHeroArt(driveId, null);
    startCdHeroArtFetch(driveId);
  },

  dismissDiscMetadataPick: (driveId) => {
    set((state) => ({
      metadataPickDriveId:
        state.metadataPickDriveId === driveId
          ? null
          : state.metadataPickDriveId,
    }));
  },

  confirmMetadataFetch: (driveId, remember) => {
    logActivity({
      level: "info",
      domain: ACTIVITY_LOG_DOMAINS.musicbrainz,
      message: "User confirmed metadata fetch",
      context: { driveId },
      details: { remember },
    });
    finishMetadataFetchPrompt(driveId, remember, "always", true, get, set);
  },

  cancelMetadataFetch: (driveId, remember) => {
    logActivity({
      level: "info",
      domain: ACTIVITY_LOG_DOMAINS.musicbrainz,
      message: "User declined metadata fetch",
      context: { driveId },
      details: { remember },
    });
    finishMetadataFetchPrompt(driveId, remember, "never", false, get, set);
  },

  resetMetadataCacheState: () => {
    set({
      metadataByDriveId: {},
      metadataCandidatesByDriveId: {},
      metadataFetchedDiscIdByDriveId: {},
      metadataPickDriveId: null,
      metadataFetchPromptDriveId: null,
      metadataFetchPromptQueue: [],
    });
  },

  setHeroArt: (driveId, artPath) => {
    set((state) => {
      const heroArtByDriveId = { ...state.heroArtByDriveId };
      if (artPath == null) {
        delete heroArtByDriveId[driveId];
      } else {
        heroArtByDriveId[driveId] = artPath;
      }
      return { heroArtByDriveId };
    });
    syncCdHeroArtToPlayback(driveId, artPath);
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
      inflightMetadataLoads.delete(driveId);
      inflightMetadataPeeks.delete(driveId);
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
