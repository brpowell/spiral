import { create } from "zustand";
import { afterUiTransition } from "../lib/scheduling";
import {
  getLibrarySettings,
  saveLibrarySettings as persistLibrarySettings,
} from "../lib/tauri";
import type {
  ImportMode,
  LibrarySettings,
  LibrarySettingsPatch,
} from "../types/library";

type ImportChoice = "copy" | "reference";

interface ImportPromptRequest {
  resolve: (choice: ImportChoice) => void;
  reject: (reason?: unknown) => void;
}

interface LibrarySettingsState {
  settings: LibrarySettings | null;
  loaded: boolean;
  preferencesOpen: boolean;
  importPrompt: ImportPromptRequest | null;
  loadSettings: () => Promise<LibrarySettings>;
  setPreferencesOpen: (open: boolean) => void;
  saveLibrarySettings: (patch: LibrarySettingsPatch) => Promise<LibrarySettings>;
  resolveImportMode: () => Promise<ImportChoice>;
  confirmImportChoice: (choice: ImportChoice, remember: boolean) => Promise<void>;
  cancelImportChoice: () => void;
}

export const useLibrarySettingsStore = create<LibrarySettingsState>(
  (set, get) => ({
    settings: null,
    loaded: false,
    preferencesOpen: false,
    importPrompt: null,

    loadSettings: async () => {
      const settings = await getLibrarySettings();
      set({ settings, loaded: true });
      return settings;
    },

    setPreferencesOpen: (open) => set({ preferencesOpen: open }),

    saveLibrarySettings: async (patch) => {
      const settings = await persistLibrarySettings(patch);
      set({ settings });
      return settings;
    },

    resolveImportMode: async () => {
      const settings = get().settings ?? (await get().loadSettings());
      if (settings.importMode === "copy") return "copy";
      if (settings.importMode === "reference") return "reference";

      return new Promise<ImportChoice>((resolve, reject) => {
        set({ importPrompt: { resolve, reject } });
      });
    },

    confirmImportChoice: async (choice, remember) => {
      const prompt = get().importPrompt;
      if (!prompt) return;

      set({ importPrompt: null });

      if (remember) {
        const importMode: ImportMode = choice === "copy" ? "copy" : "reference";
        void get().saveLibrarySettings({ importMode });
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
