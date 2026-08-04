/**
 * DEV-only toast design lab. Opens a dedicated webview (or browser tab)
 * with controls that drive a live BackgroundTasksIndicator stack.
 */
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { applyCustomWindowChrome } from "./windowChrome";
import { isTauri } from "./windowRole";

export const TOAST_LAB_LABEL = "toast-lab";
export const TOAST_LAB_QUERY = "toast-lab=1";

const TOAST_LAB_WIDTH = 980;
const TOAST_LAB_HEIGHT = 720;

function toastLabWindowUrl(): string {
  // DEV-only window; openToastLabWindow gates non-DEV callers.
  return `http://localhost:1420/?${TOAST_LAB_QUERY}`;
}

async function getToastLabWindow(): Promise<WebviewWindow | null> {
  try {
    return await WebviewWindow.getByLabel(TOAST_LAB_LABEL);
  } catch {
    return null;
  }
}

function toastLabBrowserUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.set("toast-lab", "1");
  return url.toString();
}

async function waitForToastLabWebview(
  webview: WebviewWindow,
): Promise<WebviewWindow> {
  const immediate = await getToastLabWindow();
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
      void getToastLabWindow().then(finish);
    });
    webview.once("tauri://error", (event) => {
      fail(new Error(String(event.payload)));
    });

    void getToastLabWindow().then(finish);

    void (async () => {
      for (let attempt = 0; attempt < 120 && !settled; attempt++) {
        await new Promise<void>((r) => {
          requestAnimationFrame(() => r());
        });
        if (settled) return;
        const window = await getToastLabWindow();
        if (window) {
          finish(window);
          return;
        }
      }
      if (!settled) {
        fail(new Error(`Timed out waiting for "${TOAST_LAB_LABEL}" window`));
      }
    })();
  });
}

async function revealToastLabWindow(window: WebviewWindow): Promise<void> {
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

export async function openToastLabWindow(): Promise<void> {
  if (!import.meta.env.DEV) {
    console.warn("openToastLabWindow: DEV builds only");
    return;
  }

  if (!isTauri()) {
    window.open(toastLabBrowserUrl(), "spiral-toast-lab", "noopener");
    return;
  }

  const existing = await getToastLabWindow();
  if (existing) {
    try {
      await revealToastLabWindow(existing);
    } catch (err) {
      console.error("openToastLabWindow: failed to focus existing window", err);
    }
    return;
  }

  try {
    const webview = new WebviewWindow(TOAST_LAB_LABEL, {
      url: toastLabWindowUrl(),
      title: "Toast Lab",
      width: TOAST_LAB_WIDTH,
      height: TOAST_LAB_HEIGHT,
      minWidth: 640,
      minHeight: 480,
      resizable: true,
      visible: false,
      dragDropEnabled: false,
    });
    const ready = await waitForToastLabWebview(webview);
    await revealToastLabWindow(ready);
  } catch (err) {
    console.error("openToastLabWindow: failed to create window", err);
  }
}

/** Open Toast Lab, or close it if it's already visible. */
export async function toggleToastLabWindow(): Promise<void> {
  if (!import.meta.env.DEV) return;

  if (!isTauri()) {
    // Browser tabs aren't reliably enumerable; always open/focus.
    await openToastLabWindow();
    return;
  }

  const existing = await getToastLabWindow();
  if (existing) {
    try {
      const visible = await existing.isVisible();
      if (visible && !(await existing.isMinimized())) {
        await existing.close();
        return;
      }
    } catch (err) {
      console.error("toggleToastLabWindow: failed to inspect window", err);
    }
  }

  await openToastLabWindow();
}
