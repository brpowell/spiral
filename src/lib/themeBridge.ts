import { emit, listen } from "@tauri-apps/api/event";
import { useThemeStore } from "../store/useThemeStore";
import type { WindowRole } from "./windowRole";
import { isAnySkinWindow, isAppearanceWindow } from "./windowRole";

export const THEME_CHANGED_EVENT = "theme://changed";

export interface ThemeChangedPayload {
  themeId: string;
}

async function applyThemeChange(_themeId: string): Promise<void> {
  // Reload from disk so user themes added in another window are available.
  await useThemeStore.getState().loadThemes();
}

function shouldListenForThemeChanges(role: WindowRole): boolean {
  return role === "main" || isAnySkinWindow() || isAppearanceWindow();
}

export async function initThemeBridge(role: WindowRole): Promise<() => void> {
  if (!shouldListenForThemeChanges(role)) {
    return async () => {};
  }

  const reloadThemes = () => {
    void useThemeStore.getState().loadThemes().catch((err: unknown) => {
      console.error("Failed to reload themes:", err);
    });
  };

  window.addEventListener("focus", reloadThemes);

  const unlisten = await listen<ThemeChangedPayload>(
    THEME_CHANGED_EVENT,
    (event) => {
      void applyThemeChange(event.payload.themeId).catch((err: unknown) => {
        console.error("Failed to apply theme change:", err);
      });
    },
  );

  return () => {
    window.removeEventListener("focus", reloadThemes);
    unlisten();
  };
}

export function emitThemeChanged(themeId: string): void {
  void emit(THEME_CHANGED_EVENT, { themeId } satisfies ThemeChangedPayload);
}
