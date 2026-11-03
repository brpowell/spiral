import { create } from "zustand";
import { afterUiTransition } from "../lib/scheduling";
import {
  getImportSource,
  getLibrarySettings,
  saveLibrarySettings as persistLibrarySettings,
} from "../lib/tauri";
import type { LibrarySettings, LibrarySettingsPatch } from "../types/library";
import type { PreferencesSectionId } from "../components/PreferencesModal/preferencesSections";

/** Which source an import copies into. */
export interface ImportChoice {
  /** Copies go here; unset means the import source. */
  sourceId?: number;
}

interface ImportPromptRequest {
  resolve: (choice: ImportChoice) => void;
  reject: (reason?: unknown) => void;
}

interface LibrarySettingsState {
  settings: LibrarySettings | null;
  loaded: boolean;
  preferencesOpen: boolean;
  /** When set, Preferences opens on this section then clears the focus. */
  preferencesFocusSection: PreferencesSectionId | null;
  importPrompt: ImportPromptRequest | null;
  loadSettings: () => Promise<LibrarySettings>;
  setPreferencesOpen: (open: boolean) => void;
  openPreferences: (section?: PreferencesSectionId) => void;
  consumePreferencesFocusSection: () => PreferencesSectionId | null;
  saveLibrarySettings: (
    patch: LibrarySettingsPatch,
  ) => Promise<LibrarySettings>;
  applyLibrarySettings: (settings: LibrarySettings) => void;
  /**
   * Where an import copies to: the import source when it can take the copy
   * now, else the folder the user picks in the import prompt.
   */
  resolveImportDestination: () => Promise<ImportChoice>;
  /** Answer the import prompt with the folder to copy into. */
  confirmImportChoice: (sourceId: number) => Promise<void>;
  cancelImportChoice: () => void;
}

export const useLibrarySettingsStore = create<LibrarySettingsState>(
  (set, get) => ({
    settings: null,
    loaded: false,
    preferencesOpen: false,
    preferencesFocusSection: null,
    importPrompt: null,

    loadSettings: async () => {
      const settings = await getLibrarySettings();
      set({ settings, loaded: true });
      return settings;
    },

    setPreferencesOpen: (open) =>
      set(
        open
          ? { preferencesOpen: true }
          : { preferencesOpen: false, preferencesFocusSection: null },
      ),

    openPreferences: (section) =>
      set({
        preferencesOpen: true,
        preferencesFocusSection: section ?? null,
      }),

    consumePreferencesFocusSection: () => {
      const section = get().preferencesFocusSection;
      if (section) {
        set({ preferencesFocusSection: null });
      }
      return section;
    },

    applyLibrarySettings: (settings) => set({ settings, loaded: true }),

    saveLibrarySettings: async (patch) => {
      const previous = get().settings;
      if (previous) {
        set({ settings: { ...previous, ...patch } });
      }
      try {
        const settings = await persistLibrarySettings(patch);
        set({ settings });
        return settings;
      } catch (err) {
        if (previous) set({ settings: previous });
        throw err;
      }
    },

    resolveImportDestination: async () => {
      if ((await getImportSource().catch(() => null))?.copyAvailable) {
        return {};
      }
      return new Promise<ImportChoice>((resolve, reject) => {
        set({ importPrompt: { resolve, reject } });
      });
    },

    confirmImportChoice: async (sourceId) => {
      const prompt = get().importPrompt;
      if (!prompt) return;

      set({ importPrompt: null });
      await afterUiTransition();
      prompt.resolve({ sourceId });
    },

    cancelImportChoice: () => {
      const prompt = get().importPrompt;
      if (!prompt) return;
      prompt.reject(new Error("Import cancelled"));
      set({ importPrompt: null });
    },
  }),
);
