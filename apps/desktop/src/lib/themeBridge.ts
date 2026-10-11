import { emit, listen } from "@tauri-apps/api/event";
import type { Theme } from "../types/theme";
import { applyTheme } from "./theme";
import { useThemeStore } from "../store/useThemeStore";
import type { WindowRole } from "./windowRole";
import { isAnySkinWindow, isAppearanceWindow } from "./windowRole";

export const THEME_CHANGED_EVENT = "theme://changed";
export const THEME_PREVIEW_EVENT = "theme://preview";
export const WORKSHOP_CHANGED_EVENT = "workshop://changed";

export interface ThemeChangedPayload {
  themeId: string;
}

export interface ThemePreviewPayload {
  theme: Theme;
}

/** In-memory live draft for the active theme (per window). Survives focus reloads. */
let livePreview: Theme | null = null;

/**
 * Preview that arrived before this window adopted the matching activeThemeId
 * (activate → theme://changed + theme://preview can interleave with async reload).
 */
let pendingPreview: Theme | null = null;

export function getLiveThemePreview(): Theme | null {
  return livePreview;
}

function adoptLivePreview(theme: Theme): void {
  pendingPreview = null;
  livePreview = theme;
  applyTheme(theme);
}

/** Set in the emitting window so its own theme://changed listener skips IPC reload. */
let skipNextLocalReloadForThemeId: string | null = null;

async function applyThemeChange(themeId: string): Promise<void> {
  const skipLocalReload = skipNextLocalReloadForThemeId === themeId;
  if (skipLocalReload) {
    skipNextLocalReloadForThemeId = null;
  }

  // Adopt the id immediately so interleaved theme://preview events are not
  // rejected while loadThemes() is still in flight.
  useThemeStore.setState({ activeThemeId: themeId });

  if (pendingPreview?.id === themeId) {
    adoptLivePreview(pendingPreview);
  } else if (livePreview && livePreview.id !== themeId) {
    // Different theme became active — drop the old draft preview.
    livePreview = null;
    pendingPreview = null;
  } else {
    pendingPreview = null;
  }

  // Originating window already applied / reloaded before emit — other windows
  // still run loadThemes() (their skip flag is unset).
  if (skipLocalReload) {
    return;
  }

  await useThemeStore.getState().loadThemes({ transition: true });
}

function shouldListenForThemeChanges(role: WindowRole): boolean {
  return (
    role === "main" ||
    role === "activity-logs" ||
    role === "about" ||
    role === "equalizer" ||
    role === "toast-lab" ||
    role === "sound-lab" ||
    isAnySkinWindow() ||
    isAppearanceWindow()
  );
}

export async function initThemeBridge(role: WindowRole): Promise<() => void> {
  if (!shouldListenForThemeChanges(role)) {
    return async () => {};
  }

  const reloadThemes = () => {
    // Skip while an unsaved editor draft is live-previewed.
    if (livePreview) return;
    void useThemeStore
      .getState()
      .loadThemes()
      .catch((err: unknown) => {
        console.error("Failed to reload themes:", err);
      });
  };

  // Appearance blurs frequently (native color picker, file dialogs). Reloading
  // on every focus fights the theme editor — rely on events / workshop watch.
  const listenForFocusReload = !isAppearanceWindow();
  if (listenForFocusReload) {
    window.addEventListener("focus", reloadThemes);
  }

  const unlistenTheme = await listen<ThemeChangedPayload>(
    THEME_CHANGED_EVENT,
    (event) => {
      void applyThemeChange(event.payload.themeId).catch((err: unknown) => {
        console.error("Failed to apply theme change:", err);
      });
    },
  );

  const unlistenPreview = await listen<ThemePreviewPayload>(
    THEME_PREVIEW_EVENT,
    (event) => {
      const { theme } = event.payload;
      const activeId = useThemeStore.getState().activeThemeId;
      if (theme.id !== activeId) {
        // Activation race: preview can beat theme://changed in another window.
        pendingPreview = theme;
        return;
      }
      adoptLivePreview(theme);
    },
  );

  const unlistenWorkshop = await listen(WORKSHOP_CHANGED_EVENT, () => {
    reloadThemes();
  });

  return () => {
    if (listenForFocusReload) {
      window.removeEventListener("focus", reloadThemes);
    }
    unlistenTheme();
    unlistenPreview();
    unlistenWorkshop();
  };
}

export function emitThemeChanged(
  themeId: string,
  options?: { skipLocalReload?: boolean },
): void {
  if (options?.skipLocalReload) {
    skipNextLocalReloadForThemeId = themeId;
  }
  void emit(THEME_CHANGED_EVENT, { themeId } satisfies ThemeChangedPayload);
}

/** Broadcast an in-memory draft so all windows update CSS without a disk reload. */
export function emitThemePreview(theme: Theme): void {
  void emit(THEME_PREVIEW_EVENT, { theme } satisfies ThemePreviewPayload);
}
