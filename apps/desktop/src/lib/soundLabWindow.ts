/**
 * DEV-only transport signature lab. Opens a dedicated webview (or browser tab).
 */
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { applyCustomWindowChrome, getDesktopPlatform } from "./windowChrome";
import { isTauri } from "./windowRole";

export const SOUND_LAB_LABEL = "sound-lab";
export const SOUND_LAB_QUERY = "sound-lab=1";

const SOUND_LAB_WIDTH = 1080;
const SOUND_LAB_HEIGHT = 760;

function soundLabWindowUrl(): string {
  return `http://localhost:1420/?${SOUND_LAB_QUERY}`;
}

async function getSoundLabWindow(): Promise<WebviewWindow | null> {
  try {
    return await WebviewWindow.getByLabel(SOUND_LAB_LABEL);
  } catch {
    return null;
  }
}

function soundLabBrowserUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.set("sound-lab", "1");
  return url.toString();
}

async function waitForSoundLabWebview(
  webview: WebviewWindow,
): Promise<WebviewWindow> {
  const immediate = await getSoundLabWindow();
  if (immediate) return immediate;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (window: WebviewWindow | null) => {
      if (settled || !window) return;
      settled = true;
      resolve(window);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    webview.once("tauri://created", () => {
      void getSoundLabWindow().then(finish);
    });
    webview.once("tauri://error", (event) => {
      fail(new Error(String(event.payload)));
    });

    void getSoundLabWindow().then(finish);

    void (async () => {
      for (let attempt = 0; attempt < 120 && !settled; attempt++) {
        await new Promise<void>((r) => {
          requestAnimationFrame(() => r());
        });
        if (settled) return;
        const window = await getSoundLabWindow();
        if (window) {
          finish(window);
          return;
        }
      }
      if (!settled) {
        fail(new Error(`Timed out waiting for "${SOUND_LAB_LABEL}" window`));
      }
    })();
  });
}

async function revealSoundLabWindow(window: WebviewWindow): Promise<void> {
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
}

export async function openSoundLabWindow(): Promise<void> {
  if (!import.meta.env.DEV) {
    console.warn("openSoundLabWindow: DEV builds only");
    return;
  }

  if (!isTauri()) {
    window.open(soundLabBrowserUrl(), "spiral-sound-lab", "noopener");
    return;
  }

  const existing = await getSoundLabWindow();
  if (existing) {
    try {
      await revealSoundLabWindow(existing);
    } catch (err) {
      console.error("openSoundLabWindow: failed to focus existing window", err);
    }
    return;
  }

  try {
    const webview = new WebviewWindow(SOUND_LAB_LABEL, {
      url: soundLabWindowUrl(),
      title: "Sound Lab",
      width: SOUND_LAB_WIDTH,
      height: SOUND_LAB_HEIGHT,
      minWidth: 720,
      minHeight: 520,
      resizable: true,
      visible: false,
      dragDropEnabled: false,
      ...(getDesktopPlatform() === "macos"
        ? { titleBarStyle: "overlay" as const, hiddenTitle: true }
        : {}),
    });
    const ready = await waitForSoundLabWebview(webview);
    await revealSoundLabWindow(ready);
  } catch (err) {
    console.error("openSoundLabWindow: failed to create window", err);
  }
}

/** Open Sound Lab, or close it if it's already visible. */
export async function toggleSoundLabWindow(): Promise<void> {
  if (!import.meta.env.DEV) return;

  if (!isTauri()) {
    await openSoundLabWindow();
    return;
  }

  const existing = await getSoundLabWindow();
  if (existing) {
    try {
      const visible = await existing.isVisible();
      if (visible && !(await existing.isMinimized())) {
        await existing.close();
        return;
      }
    } catch (err) {
      console.error("toggleSoundLabWindow: failed to inspect window", err);
    }
  }

  await openSoundLabWindow();
}
