/**
 * DEV-only Icon Lab: browse every icon, edit tags, and try the icon picker.
 * Opens a dedicated webview (or a browser tab outside Tauri).
 */
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { applyCustomWindowChrome, getDesktopPlatform } from "./windowChrome";
import { isTauri } from "./windowRole";

export const ICON_LAB_LABEL = "icon-lab";
export const ICON_LAB_QUERY = "icon-lab=1";

async function getIconLabWindow(): Promise<WebviewWindow | null> {
  try {
    return await WebviewWindow.getByLabel(ICON_LAB_LABEL);
  } catch {
    return null;
  }
}

async function revealIconLabWindow(window: WebviewWindow): Promise<void> {
  if (await window.isVisible()) {
    if (await window.isMinimized()) await window.unminimize();
  } else {
    await window.center();
    await window.show();
  }
  await applyCustomWindowChrome(window);
  await window.setFocus();
}

/** Resolve once the webview exists (`getByLabel` can lag behind creation). */
function waitForIconLabWindow(webview: WebviewWindow): Promise<WebviewWindow> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (found: WebviewWindow | null) => {
      if (settled || !found) return;
      settled = true;
      resolve(found);
    };
    webview.once("tauri://created", () => {
      void getIconLabWindow().then(finish);
    });
    webview.once("tauri://error", (event) => {
      if (settled) return;
      settled = true;
      reject(new Error(String(event.payload)));
    });
    void getIconLabWindow().then(finish);
  });
}

export async function openIconLabWindow(): Promise<void> {
  if (!import.meta.env.DEV) {
    console.warn("openIconLabWindow: DEV builds only");
    return;
  }

  if (!isTauri()) {
    const url = new URL(window.location.href);
    url.searchParams.set("icon-lab", "1");
    window.open(url.toString(), "spiral-icon-lab", "noopener");
    return;
  }

  const existing = await getIconLabWindow();
  if (existing) {
    try {
      await revealIconLabWindow(existing);
    } catch (err) {
      console.error("openIconLabWindow: failed to focus existing window", err);
    }
    return;
  }

  try {
    const webview = new WebviewWindow(ICON_LAB_LABEL, {
      url: `http://localhost:1420/?${ICON_LAB_QUERY}`,
      title: "Icon Lab",
      width: 1180,
      height: 780,
      minWidth: 760,
      minHeight: 520,
      resizable: true,
      visible: false,
      dragDropEnabled: false,
      ...(getDesktopPlatform() === "macos"
        ? { titleBarStyle: "overlay" as const, hiddenTitle: true }
        : {}),
    });
    await revealIconLabWindow(await waitForIconLabWindow(webview));
  } catch (err) {
    console.error("openIconLabWindow: failed to create window", err);
  }
}

/** Open Icon Lab, or close it if it's already visible. */
export async function toggleIconLabWindow(): Promise<void> {
  if (!import.meta.env.DEV) return;

  if (isTauri()) {
    const existing = await getIconLabWindow();
    if (existing) {
      try {
        if ((await existing.isVisible()) && !(await existing.isMinimized())) {
          await existing.close();
          return;
        }
      } catch (err) {
        console.error("toggleIconLabWindow: failed to inspect window", err);
      }
    }
  }
  await openIconLabWindow();
}
