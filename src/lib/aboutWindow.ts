import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { applyCustomWindowChrome } from "./windowChrome";
import { isTauri } from "./windowRole";
import type { AboutTabId } from "../components/About/aboutContent";

const ABOUT_LABEL = "about";

export const ABOUT_FOCUS_TAB_EVENT = "about://focus-tab";

export type { AboutTabId };

async function getAboutWindow(): Promise<WebviewWindow | null> {
  try {
    return await WebviewWindow.getByLabel(ABOUT_LABEL);
  } catch {
    return null;
  }
}

export async function openAboutWindow(tab?: AboutTabId): Promise<void> {
  if (!isTauri()) {
    console.warn("openAboutWindow: not running in Tauri");
    return;
  }

  const window = await getAboutWindow();
  if (!window) {
    console.error(`openAboutWindow: no webview with label "${ABOUT_LABEL}"`);
    return;
  }

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

  const window = await getAboutWindow();
  if (!window) return;

  try {
    await window.hide();
  } catch (err) {
    console.error("hideAboutWindow:", err);
  }
}
