import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { applyCustomWindowChrome } from "./windowChrome";
import { isTauri } from "./windowRole";

export type AppearanceSection =
  "themes" | "visualizers" | "skins" | "packs" | "catalog";

export const APPEARANCE_NAVIGATE_EVENT = "appearance://navigate";
export const APPEARANCE_REFRESH_EVENT = "appearance://refresh";
/** Manual reload of linked pack paths (View → Reload Linked Packs / Cmd+Alt+R). */
export const RELOAD_LINKED_PACKS_EVENT = "packs://reload-linked";

/** Fired when a pack is linked or unlinked so the app menu can update. */
export const LINKED_PACKS_CHANGED_EVENT = "packs://linked-changed";

/** Cross-window sync of pending pack updates (main ↔ Studio). */
export const PACK_UPDATES_CHANGED_EVENT = "packs://updates-changed";

export interface AppearanceNavigatePayload {
  section: AppearanceSection;
  packId?: string;
}

const APPEARANCE_LABEL = "appearance";

const STORAGE_KEY = "appearance.lastSection";

function isAppearanceSection(value: string): value is AppearanceSection {
  return (
    value === "themes" ||
    value === "visualizers" ||
    value === "skins" ||
    value === "packs" ||
    value === "catalog"
  );
}

export function getStoredAppearanceSection(): AppearanceSection {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isAppearanceSection(stored)) {
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
  packId?: string,
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
      if (await window.isMinimized()) {
        await window.unminimize();
      }
    } else {
      await window.center();
      await window.show();
    }

    await applyCustomWindowChrome(window);
    await window.setFocus();
    void emit(APPEARANCE_NAVIGATE_EVENT, {
      section: resolvedSection,
      packId,
    } satisfies AppearanceNavigatePayload);
    void emit(APPEARANCE_REFRESH_EVENT, {});
  } catch (err) {
    console.error(
      "openAppearanceWindow: failed to show appearance window",
      err,
    );
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
