import { create } from "zustand";
import {
  applyTheme,
  DEFAULT_THEME_ID,
  findThemeByName,
} from "../lib/theme";
import { emitThemeChanged } from "../lib/themeBridge";
import {
  getActiveThemeId,
  getBuiltinThemes,
  importUserTheme,
  loadUserThemes,
  openThemesFolder,
  saveActiveThemeId,
} from "../lib/tauri";
import type { Theme } from "../types/theme";

interface ThemeState {
  themes: Theme[];
  activeThemeId: string;
  themePickerOpen: boolean;
  themesLoaded: boolean;
  loadThemes: () => Promise<void>;
  initializeFromBootstrap: (
    themes: Theme[],
    activeThemeId: string,
  ) => void;
  setTheme: (name: string) => Promise<void>;
  importTheme: () => Promise<void>;
  openThemesFolder: () => Promise<void>;
  setThemePickerOpen: (open: boolean) => void;
}

function applyActiveTheme(themes: Theme[], activeThemeId: string): void {
  const theme =
    findThemeByName(themes, activeThemeId) ??
    findThemeByName(themes, DEFAULT_THEME_ID) ??
    themes[0];
  if (theme) {
    applyTheme(theme);
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themes: [],
  activeThemeId: DEFAULT_THEME_ID,
  themePickerOpen: false,
  themesLoaded: false,

  initializeFromBootstrap: (themes, activeThemeId) => {
    applyActiveTheme(themes, activeThemeId);
    set({ themes, activeThemeId, themesLoaded: true });
  },

  loadThemes: async () => {
    const [builtin, user, activeThemeId] = await Promise.all([
      getBuiltinThemes(),
      loadUserThemes(),
      getActiveThemeId(),
    ]);
    const themes = [...builtin, ...user];
    applyActiveTheme(themes, activeThemeId);
    set({ themes, activeThemeId, themesLoaded: true });
  },

  setTheme: async (name) => {
    const { themes } = get();
    const theme = findThemeByName(themes, name);
    if (!theme) return;

    applyTheme(theme);
    set({ activeThemeId: name });
    await saveActiveThemeId(name);
    emitThemeChanged(name);
  },

  importTheme: async () => {
    const imported = await importUserTheme();
    if (!imported) return;

    await get().loadThemes();
    await get().setTheme(imported.name);
  },

  openThemesFolder: async () => {
    await openThemesFolder();
  },

  setThemePickerOpen: (open) => set({ themePickerOpen: open }),
}));
