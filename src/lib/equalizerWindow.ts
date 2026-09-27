import { ensureAppWindow, releaseAppWindow } from "./appWindows";
import { applyCustomWindowChrome } from "./windowChrome";
import { isTauri } from "./windowRole";

const EQUALIZER_LABEL = "equalizer";

export async function openEqualizerWindow(): Promise<void> {
  if (!isTauri()) {
    console.warn("openEqualizerWindow: not running in Tauri");
    return;
  }

  const window = await ensureAppWindow(EQUALIZER_LABEL);
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
  } catch (err) {
    console.error("openEqualizerWindow: failed to show equalizer window", err);
  }
}

export async function hideEqualizerWindow(): Promise<void> {
  if (!isTauri()) return;
  await releaseAppWindow(EQUALIZER_LABEL);
}
