import { create } from "zustand";
import {
  clearRegistrationWrap,
  finalizeRegistration as finalizeRegistrationInvoke,
  getLicenseState,
  installRegistrationCard,
  pickCardWrapFile,
  pickSpcardFile,
  setRegistrationWrapFromFile,
  updateRegistrationCosmetic,
} from "../lib/tauri";
import {
  defaultLicenseSnapshot,
  type LicenseCosmetic,
  type LicenseSnapshot,
} from "../types/license";

interface LicenseState {
  snapshot: LicenseSnapshot;
  loaded: boolean;
  spiralCardOpen: boolean;
  /** Queued `.spcard` path awaiting replace confirmation. */
  pendingReplacePath: string | null;
  /** In-memory; resets each app launch. */
  readyToFinalizePromptShown: boolean;
  loadLicense: () => Promise<LicenseSnapshot>;
  installFromPicker: () => Promise<LicenseSnapshot | null>;
  installFromPath: (path: string) => Promise<LicenseSnapshot>;
  finalizeRegistration: () => Promise<LicenseSnapshot>;
  updateCosmetic: (cosmetic: LicenseCosmetic) => Promise<LicenseSnapshot>;
  setWrapFromPicker: () => Promise<LicenseSnapshot | null>;
  clearWrap: () => Promise<LicenseSnapshot>;
  setPendingReplacePath: (path: string | null) => void;
  setSpiralCardOpen: (open: boolean) => void;
  openSpiralCard: () => void;
  /** Once per session when status is readyToFinalize. */
  maybeOpenReadyToFinalizePrompt: () => void;
}

export const useLicenseStore = create<LicenseState>((set, get) => ({
  snapshot: defaultLicenseSnapshot(),
  loaded: false,
  spiralCardOpen: false,
  pendingReplacePath: null,
  readyToFinalizePromptShown: false,

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
      readyToFinalizePromptShown:
        get().readyToFinalizePromptShown ||
        snapshot.status === "readyToFinalize",
    });
    return snapshot;
  },

  finalizeRegistration: async () => {
    const snapshot = await finalizeRegistrationInvoke();
    set({ snapshot, loaded: true });
    return snapshot;
  },

  updateCosmetic: async (cosmetic) => {
    const snapshot = await updateRegistrationCosmetic(cosmetic);
    set({ snapshot, loaded: true });
    return snapshot;
  },

  setWrapFromPicker: async () => {
    const path = await pickCardWrapFile();
    if (!path) return null;
    const snapshot = await setRegistrationWrapFromFile(path);
    set({ snapshot, loaded: true });
    return snapshot;
  },

  clearWrap: async () => {
    const snapshot = await clearRegistrationWrap();
    set({ snapshot, loaded: true });
    return snapshot;
  },

  setPendingReplacePath: (path) => set({ pendingReplacePath: path }),

  setSpiralCardOpen: (open) => set({ spiralCardOpen: open }),

  openSpiralCard: () => set({ spiralCardOpen: true }),

  maybeOpenReadyToFinalizePrompt: () => {
    const { readyToFinalizePromptShown, snapshot } = get();
    if (readyToFinalizePromptShown) return;
    if (snapshot.status !== "readyToFinalize") return;
    set({ spiralCardOpen: true, readyToFinalizePromptShown: true });
  },
}));
