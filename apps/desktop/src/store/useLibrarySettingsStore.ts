import { create } from "zustand";
import { afterUiTransition } from "../lib/scheduling";
import {
  getLibrarySettings,
  saveLibrarySettings as persistLibrarySettings,
  setImportSource,
} from "../lib/tauri";
import type {
  ImportMode,
  LibrarySettings,
  LibrarySettingsPatch,
} from "../types/library";
import { useSourcesStore } from "./useSourcesStore";
import type { PreferencesSectionId } from "../components/PreferencesModal/preferencesSections";

type ImportMethod = "copy" | "reference";

/** How to add files, and for copies, which source they go into. */
export interface ImportChoice {
  mode: ImportMethod;
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
  saveLibrarySettings: (patch: LibrarySettingsPatch) => Promise<LibrarySettings>;
  applyLibrarySettings: (settings: LibrarySettings) => void;
  resolveImportMode: () => Promise<ImportChoice>;
  /** Answer the import prompt. Remembering a copy into another source makes it the import source. */
  confirmImportChoice: (choice: ImportChoice, remember: boolean) => Promise<void>;
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

    resolveImportMode: async () => {
      const settings = get().settings ?? (await get().loadSettings());
      if (settings.importMode === "copy") return { mode: "copy" };
      if (settings.importMode === "reference") return { mode: "reference" };

      return new Promise<ImportChoice>((resolve, reject) => {
        set({ importPrompt: { resolve, reject } });
      });
    },

    confirmImportChoice: async (choice, remember) => {
      const prompt = get().importPrompt;
      if (!prompt) return;

      set({ importPrompt: null });

      if (remember) {
        const importMode: ImportMode = choice.mode;
        void get().saveLibrarySettings({ importMode });
        if (choice.mode === "copy" && choice.sourceId != null) {
          try {
            await setImportSource(choice.sourceId);
            await useSourcesStore.getState().loadSources();
          } catch (err) {
            console.error("setImportSource failed:", err);
          }
        }
      }

      await afterUiTransition();
      prompt.resolve(choice);
    },

    cancelImportChoice: () => {
      const prompt = get().importPrompt;
      if (!prompt) return;
      prompt.reject(new Error("Import cancelled"));
      set({ importPrompt: null });
    },
  }),
);
