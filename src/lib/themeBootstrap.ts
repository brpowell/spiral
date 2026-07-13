import { applyTheme, DEFAULT_THEME_ID, findThemeById, resolveActiveThemeId } from "./theme";
import {
  getActiveThemeId,
  getBuiltinThemes,
  loadUserThemes,
  saveActiveThemeId,
} from "./tauri";
import { useThemeStore } from "../store/useThemeStore";
import type { Theme } from "../types/theme";

export async function bootstrapTheme(): Promise<void> {
  let builtin: Theme[] = [];
  let user: Theme[] = [];
  let activeThemeId = DEFAULT_THEME_ID;

  try {
    [builtin, user, activeThemeId] = await Promise.all([
      getBuiltinThemes(),
      loadUserThemes(),
      getActiveThemeId(),
    ]);
  } catch {
    useThemeStore.getState().initializeFromBootstrap([], DEFAULT_THEME_ID);
    return;
  }

  const themes: Theme[] = [...builtin, ...user];
  const resolvedId = resolveActiveThemeId(themes, activeThemeId);
  const theme = findThemeById(themes, resolvedId);

  if (theme) {
    applyTheme(theme);
  }

  if (resolvedId !== activeThemeId) {
    try {
      await saveActiveThemeId(resolvedId);
    } catch {
      // Settings write failed; in-memory state is still corrected.
    }
  }

  useThemeStore.getState().initializeFromBootstrap(themes, resolvedId);
}
