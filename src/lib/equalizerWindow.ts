import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { applyCustomWindowChrome } from "./windowChrome";
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
      if (await window.isMinimized()) {
        await window.unminimize();
      }
    } else {
      await window.center();
      await window.show();
    }

    await applyCustomWindowChrome(window);
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
