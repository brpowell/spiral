import { create } from "zustand";
import {
  pullCurrentGrant as pullCurrentGrantInvoke,
  getLicensePromptState,
  getLicenseState,
  installRegistrationCard,
  installRegistrationCardJson,
  patchLicensePromptState,
  pickSpcardFile,
} from "../lib/tauri";
import { defaultLicenseSnapshot, type LicenseSnapshot } from "../types/license";

export type PendingSpcardReplace =
  { kind: "path"; path: string } | { kind: "json"; json: string };

/** Local calendar day `YYYY-MM-DD` for card-update prompt cadence. */
export function localDateYmd(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function markUpdatePromptShownToday(): Promise<void> {
  const today = localDateYmd();
  try {
    const current = await getLicensePromptState();
    if (current.lastUpdatePromptDate === today) return;
    await patchLicensePromptState({ lastUpdatePromptDate: today });
  } catch (err) {
    console.error("Failed to persist license prompt state:", err);
  }
}

async function clearPendingDemotedNotice(): Promise<void> {
  try {
    await patchLicensePromptState({ pendingDemoted: null });
  } catch (err) {
    console.error("Failed to clear pending demote notice:", err);
  }
}

interface LicenseState {
  snapshot: LicenseSnapshot;
  loaded: boolean;
  spiralCardOpen: boolean;
  /** Queued card awaiting replace confirmation. */
  pendingReplace: PendingSpcardReplace | null;
  loadLicense: () => Promise<LicenseSnapshot>;
  installFromPicker: () => Promise<LicenseSnapshot | null>;
  installFromPath: (path: string) => Promise<LicenseSnapshot>;
  installFromJson: (json: string) => Promise<LicenseSnapshot>;
  pullCurrentGrant: () => Promise<LicenseSnapshot>;
  setPendingReplace: (source: PendingSpcardReplace | null) => void;
  setSpiralCardOpen: (open: boolean) => void;
  openSpiralCard: () => void;
  /** Trial restore layout after grace demote / expired install. */
  openRestoreSpiralCard: () => void;
  /**
   * Open the ready-to-update modal when appropriate.
   * - `launch`: always (every cold start / relaunch).
   * - `session`: at most once per local calendar day (long-running app).
   */
  maybeOpenReadyToUpdatePrompt: (
    reason?: "launch" | "session",
  ) => Promise<void>;
  /** Open restore layout once when load returns demoted=grace. */
  maybeOpenGraceDemotePrompt: () => void;
}

export const useLicenseStore = create<LicenseState>((set, get) => ({
  snapshot: defaultLicenseSnapshot(),
  loaded: false,
  spiralCardOpen: false,
  pendingReplace: null,

  loadLicense: async () => {
    const snapshot = await getLicenseState();
    set({ snapshot, loaded: true });
    return snapshot;
  },

  installFromPicker: async () => {
    const path = await pickSpcardFile();
    if (!path) return null;
    return get().installFromPath(path);
  },

  installFromPath: async (path) => {
    const snapshot = await installRegistrationCard(path);
    set({
      snapshot,
      loaded: true,
      spiralCardOpen: true,
    });
    if (snapshot.status === "readyToUpdate") {
      await markUpdatePromptShownToday();
    }
    return snapshot;
  },

  installFromJson: async (json) => {
    const snapshot = await installRegistrationCardJson(json);
    set({
      snapshot,
      loaded: true,
      spiralCardOpen: true,
    });
    if (snapshot.status === "readyToUpdate") {
      await markUpdatePromptShownToday();
    }
    return snapshot;
  },

  pullCurrentGrant: async () => {
    const snapshot = await pullCurrentGrantInvoke();
    set({ snapshot, loaded: true });
    return snapshot;
  },

  setPendingReplace: (source) => set({ pendingReplace: source }),

  setSpiralCardOpen: (open) => {
    if (!open) {
      const { snapshot } = get();
      // Clear demote outcomes on close so reopen shows normal trial copy.
      if (snapshot.demoted) {
        void clearPendingDemotedNotice();
        set({
          spiralCardOpen: false,
          snapshot: { ...snapshot, demoted: null },
        });
        return;
      }
    }
    set({ spiralCardOpen: open });
  },

  openSpiralCard: () => set({ spiralCardOpen: true }),

  openRestoreSpiralCard: () => {
    const { snapshot } = get();
    set({
      spiralCardOpen: true,
      snapshot: { ...snapshot, demoted: "grace" },
    });
  },

  maybeOpenReadyToUpdatePrompt: async (reason = "launch") => {
    const { snapshot, pendingReplace, spiralCardOpen } = get();
    if (pendingReplace || spiralCardOpen) return;
    if (snapshot.status !== "readyToUpdate") return;
    const today = localDateYmd();
    try {
      if (reason === "session") {
        const prompt = await getLicensePromptState();
        if (prompt.lastUpdatePromptDate === today) return;
      }
      set({ spiralCardOpen: true });
      await patchLicensePromptState({ lastUpdatePromptDate: today });
    } catch (err) {
      console.error("Failed to check license update prompt:", err);
    }
  },

  maybeOpenGraceDemotePrompt: () => {
    const { snapshot, pendingReplace, spiralCardOpen } = get();
    if (pendingReplace || spiralCardOpen) return;
    if (snapshot.demoted !== "grace") return;
    set({ spiralCardOpen: true });
  },
}));
