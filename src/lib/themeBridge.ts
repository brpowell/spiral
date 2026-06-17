import { emit, listen } from "@tauri-apps/api/event";
import { applyTheme, findThemeByName } from "./theme";
import { useThemeStore } from "../store/useThemeStore";
import type { WindowRole } from "./windowRole";
import { isAppearanceWindow, isSkinModeWindow } from "./windowRole";

export const THEME_CHANGED_EVENT = "theme://changed";

export interface ThemeChangedPayload {
  themeId: string;
}

function applyThemeChange(themeId: string): void {
  const { themes } = useThemeStore.getState();
  const theme = findThemeByName(themes, themeId);
  if (!theme) return;

  useThemeStore.setState({ activeThemeId: themeId }, false);
  applyTheme(theme);
}

function shouldListenForThemeChanges(role: WindowRole): boolean {
  return role === "main" || isSkinModeWindow() || isAppearanceWindow();
}

export async function initThemeBridge(role: WindowRole): Promise<() => void> {
  if (!shouldListenForThemeChanges(role)) {
    return async () => {};
  }

  const unlisten = await listen<ThemeChangedPayload>(
    THEME_CHANGED_EVENT,
    (event) => {
      applyThemeChange(event.payload.themeId);
    },
  );

  return () => {
    unlisten();
  };
}

export function emitThemeChanged(themeId: string): void {
  void emit(THEME_CHANGED_EVENT, { themeId } satisfies ThemeChangedPayload);
}
