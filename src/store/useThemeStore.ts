import { create } from "zustand";
import {
  applyTheme,
  DEFAULT_THEME_ID,
  findThemeById,
  resolveActiveThemeId,
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
  themesLoaded: boolean;
  loadThemes: () => Promise<void>;
  initializeFromBootstrap: (
    themes: Theme[],
    activeThemeId: string,
  ) => void;
  setTheme: (themeId: string) => Promise<void>;
  importTheme: () => Promise<void>;
  openThemesFolder: () => Promise<void>;
}

function applyActiveTheme(themes: Theme[], activeThemeId: string): string {
  const resolvedId = resolveActiveThemeId(themes, activeThemeId);
  const theme = findThemeById(themes, resolvedId);
  if (theme) {
    applyTheme(theme);
  }
  return resolvedId;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themes: [],
  activeThemeId: DEFAULT_THEME_ID,
  themesLoaded: false,

  initializeFromBootstrap: (themes, activeThemeId) => {
    const resolvedId = applyActiveTheme(themes, activeThemeId);
    set({ themes, activeThemeId: resolvedId, themesLoaded: true });
  },

  loadThemes: async () => {
    const [builtin, user, storedActiveThemeId] = await Promise.all([
      getBuiltinThemes(),
      loadUserThemes(),
      getActiveThemeId(),
    ]);
    const themes = [...builtin, ...user];
    const resolvedId = applyActiveTheme(themes, storedActiveThemeId);
    set({ themes, activeThemeId: resolvedId, themesLoaded: true });

    if (resolvedId !== storedActiveThemeId) {
      await saveActiveThemeId(resolvedId);
      emitThemeChanged(resolvedId);
    }
  },

  setTheme: async (themeId) => {
    const { themes } = get();
    const theme = findThemeById(themes, themeId);
    if (!theme) return;

    applyTheme(theme);
    set({ activeThemeId: theme.id });
    await saveActiveThemeId(theme.id);
    emitThemeChanged(theme.id);
  },

  importTheme: async () => {
    const imported = await importUserTheme();
    if (!imported) return;

    await get().loadThemes();
    await get().setTheme(imported.id);
  },

  openThemesFolder: async () => {
    await openThemesFolder();
  },
}));
