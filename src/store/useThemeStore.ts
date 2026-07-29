import { create } from "zustand";
import {
  applyTheme,
  DEFAULT_THEME_ID,
  findThemeById,
  resolveActiveThemeId,
} from "../lib/theme";
import { emitThemeChanged, getLiveThemePreview } from "../lib/themeBridge";
import {
  createWorkshopTheme,
  deleteWorkshopTheme,
  getActiveThemeId,
  getBuiltinThemes,
  loadUserThemes,
  saveActiveThemeId,
  saveWorkshopTheme,
} from "../lib/tauri";
import {
  formatThemeValidationError,
  validateThemeForApply,
  validateThemeForSave,
} from "../lib/themeValidation";
import type { Theme } from "../types/theme";

interface ThemeState {
  themes: Theme[];
  activeThemeId: string;
  themesLoaded: boolean;
  loadThemes: (options?: { transition?: boolean }) => Promise<void>;
  initializeFromBootstrap: (
    themes: Theme[],
    activeThemeId: string,
  ) => void;
  setTheme: (themeId: string) => Promise<void>;
  createTheme: (args?: {
    name?: string;
    packId?: string;
    packName?: string;
  }) => Promise<Theme>;
  saveTheme: (theme: Theme) => Promise<Theme>;
  deleteTheme: (themeId: string) => Promise<void>;
}

function applyActiveTheme(
  themes: Theme[],
  activeThemeId: string,
  options?: { transition?: boolean },
): string {
  const resolvedId = resolveActiveThemeId(themes, activeThemeId);
  const preview = getLiveThemePreview();
  if (preview && preview.id === resolvedId) {
    // Keep unsaved editor draft visible across window focus / list reloads.
    applyTheme(preview);
  } else {
    const theme = findThemeById(themes, resolvedId);
    if (theme) {
      applyTheme(theme, options);
    }
  }
  return resolvedId;
}

function upsertTheme(themes: Theme[], theme: Theme): Theme[] {
  const next = themes.filter((t) => t.id !== theme.id);
  next.push(theme);
  next.sort((a, b) => a.name.localeCompare(b.name));
  return next;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themes: [],
  activeThemeId: DEFAULT_THEME_ID,
  themesLoaded: false,

  initializeFromBootstrap: (themes, activeThemeId) => {
    const resolvedId = applyActiveTheme(themes, activeThemeId);
    set({ themes, activeThemeId: resolvedId, themesLoaded: true });
  },

  loadThemes: async (options) => {
    const [builtin, user, storedActiveThemeId] = await Promise.all([
      getBuiltinThemes(),
      loadUserThemes(),
      getActiveThemeId(),
    ]);
    const themes = [...builtin, ...user];
    const resolvedId = applyActiveTheme(
      themes,
      storedActiveThemeId,
      options,
    );
    set({ themes, activeThemeId: resolvedId, themesLoaded: true });

    if (resolvedId !== storedActiveThemeId) {
      await saveActiveThemeId(resolvedId);
      emitThemeChanged(resolvedId, { skipLocalReload: true });
    }
  },

  setTheme: async (themeId) => {
    const { themes } = get();
    const theme = findThemeById(themes, themeId);
    if (!theme) return;

    const issues = validateThemeForApply(theme);
    if (issues.length > 0) {
      throw new Error(formatThemeValidationError(issues));
    }

    applyTheme(theme, { transition: true });
    set({ activeThemeId: theme.id });
    await saveActiveThemeId(theme.id);
    emitThemeChanged(theme.id, { skipLocalReload: true });
  },

  createTheme: async (args) => {
    const theme = await createWorkshopTheme(args);
    set({ themes: upsertTheme(get().themes, theme) });
    return theme;
  },

  saveTheme: async (theme) => {
    const issues = validateThemeForSave(theme);
    if (issues.length > 0) {
      throw new Error(formatThemeValidationError(issues));
    }
    const saved = await saveWorkshopTheme(theme);
    const { themes, activeThemeId } = get();
    const nextThemes = upsertTheme(themes, saved);
    if (activeThemeId === saved.id) {
      applyTheme(saved);
    }
    set({ themes: nextThemes });
    emitThemeChanged(saved.id, { skipLocalReload: true });
    return saved;
  },

  deleteTheme: async (themeId) => {
    await deleteWorkshopTheme(themeId);
    await get().loadThemes();
    emitThemeChanged(get().activeThemeId, { skipLocalReload: true });
  },
}));
