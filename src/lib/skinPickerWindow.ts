import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { SKIN_PICKER_REFRESH_EVENT } from "./skinBridge";
import { isTauri } from "./windowRole";

const SKIN_PICKER_LABEL = "skin-picker";

async function getSkinPickerWindow(): Promise<WebviewWindow | null> {
  try {
    return await WebviewWindow.getByLabel(SKIN_PICKER_LABEL);
  } catch {
    return null;
  }
}

export async function openSkinPickerWindow(): Promise<void> {
  if (!isTauri()) {
    console.warn("openSkinPickerWindow: not running in Tauri");
    return;
  }

  const window = await getSkinPickerWindow();
  if (!window) {
    console.error(
      `openSkinPickerWindow: no webview with label "${SKIN_PICKER_LABEL}"`,
    );
    return;
  }

  try {
    const visible = await window.isVisible();
    if (visible) {
      const minimized = await window.isMinimized();
      if (minimized) {
        await window.unminimize();
      }
      await window.setFocus();
      void emit(SKIN_PICKER_REFRESH_EVENT, {});
      return;
    }

    await window.center();
    await window.show();
    await window.setFocus();
    void emit(SKIN_PICKER_REFRESH_EVENT, {});
  } catch (err) {
    console.error("openSkinPickerWindow: failed to show picker", err);
  }
}

export async function hideSkinPickerWindow(): Promise<void> {
  if (!isTauri()) return;

  const window = await getSkinPickerWindow();
  if (!window) return;

  try {
    await window.hide();
  } catch (err) {
    console.error("hideSkinPickerWindow:", err);
  }
}

export async function isSkinPickerVisible(): Promise<boolean> {
  if (!isTauri()) return false;
  const window = await getSkinPickerWindow();
  if (!window) return false;
  return window.isVisible();
}
