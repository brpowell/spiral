import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "./windowRole";

export type AppearanceSection = "themes" | "visualizers" | "skins";

export const APPEARANCE_NAVIGATE_EVENT = "appearance://navigate";
export const APPEARANCE_REFRESH_EVENT = "appearance://refresh";

export interface AppearanceNavigatePayload {
  section: AppearanceSection;
}

const APPEARANCE_LABEL = "appearance";

const STORAGE_KEY = "appearance.lastSection";

export function getStoredAppearanceSection(): AppearanceSection {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "themes" || stored === "visualizers" || stored === "skins") {
      return stored;
    }
  } catch {
    // ignore
  }
  return "themes";
}

export function storeAppearanceSection(section: AppearanceSection): void {
  try {
    localStorage.setItem(STORAGE_KEY, section);
  } catch {
    // ignore
  }
}

async function getAppearanceWindow(): Promise<WebviewWindow | null> {
  try {
    return await WebviewWindow.getByLabel(APPEARANCE_LABEL);
  } catch {
    return null;
  }
}

export async function openAppearanceWindow(
  section?: AppearanceSection,
): Promise<void> {
  if (!isTauri()) {
    console.warn("openAppearanceWindow: not running in Tauri");
    return;
  }

  const window = await getAppearanceWindow();
  if (!window) {
    console.error(
      `openAppearanceWindow: no webview with label "${APPEARANCE_LABEL}"`,
    );
    return;
  }

  const resolvedSection = section ?? getStoredAppearanceSection();

  try {
    const visible = await window.isVisible();
    if (visible) {
      const minimized = await window.isMinimized();
      if (minimized) {
        await window.unminimize();
      }
      await window.setFocus();
      void emit(APPEARANCE_NAVIGATE_EVENT, {
        section: resolvedSection,
      } satisfies AppearanceNavigatePayload);
      void emit(APPEARANCE_REFRESH_EVENT, {});
      return;
    }

    void emit(APPEARANCE_NAVIGATE_EVENT, {
      section: resolvedSection,
    } satisfies AppearanceNavigatePayload);

    await window.center();
    await window.show();
    await window.setFocus();
    void emit(APPEARANCE_REFRESH_EVENT, {});
  } catch (err) {
    console.error("openAppearanceWindow: failed to show appearance window", err);
  }
}

export async function hideAppearanceWindow(): Promise<void> {
  if (!isTauri()) return;

  const window = await getAppearanceWindow();
  if (!window) return;

  try {
    await window.hide();
  } catch (err) {
    console.error("hideAppearanceWindow:", err);
  }
}
