import { emit } from "@tauri-apps/api/event";
import { ensureAppWindow, releaseAppWindow } from "./appWindows";
import { applyCustomWindowChrome } from "./windowChrome";
import { isTauri } from "./windowRole";
import type { AboutTabId } from "../components/About/aboutContent";

const ABOUT_LABEL = "about";

export const ABOUT_FOCUS_TAB_EVENT = "about://focus-tab";

export type { AboutTabId };

export async function openAboutWindow(tab?: AboutTabId): Promise<void> {
  if (!isTauri()) {
    console.warn("openAboutWindow: not running in Tauri");
    return;
  }

  const window = await ensureAppWindow(ABOUT_LABEL);
  if (!window) return;

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

    if (tab != null) {
      void emit(ABOUT_FOCUS_TAB_EVENT, tab);
    }
  } catch (err) {
    console.error("openAboutWindow: failed to show about window", err);
  }
}

export async function hideAboutWindow(): Promise<void> {
  if (!isTauri()) return;
  await releaseAppWindow(ABOUT_LABEL);
}
