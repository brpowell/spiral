import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "./windowRole";

const EQUALIZER_LABEL = "equalizer";

async function getEqualizerWindow(): Promise<WebviewWindow | null> {
  try {
    return await WebviewWindow.getByLabel(EQUALIZER_LABEL);
  } catch {
    return null;
  }
}

export async function openEqualizerWindow(): Promise<void> {
  if (!isTauri()) {
    console.warn("openEqualizerWindow: not running in Tauri");
    return;
  }

  const window = await getEqualizerWindow();
  if (!window) {
    console.error(
      `openEqualizerWindow: no webview with label "${EQUALIZER_LABEL}"`,
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
      return;
    }

    await window.center();
    await window.show();
    await window.setFocus();
  } catch (err) {
    console.error("openEqualizerWindow: failed to show equalizer window", err);
  }
}

export async function hideEqualizerWindow(): Promise<void> {
  if (!isTauri()) return;

  const window = await getEqualizerWindow();
  if (!window) return;

  try {
    await window.hide();
  } catch (err) {
    console.error("hideEqualizerWindow:", err);
  }
}
