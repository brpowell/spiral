import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { applyCustomWindowChrome } from "./windowChrome";
import { isTauri } from "./windowRole";

const ACTIVITY_LOGS_LABEL = "activity-logs";

async function getActivityLogsWindow(): Promise<WebviewWindow | null> {
  try {
    return await WebviewWindow.getByLabel(ACTIVITY_LOGS_LABEL);
  } catch {
    return null;
  }
}

export async function openActivityLogsWindow(): Promise<void> {
  if (!isTauri()) {
    console.warn("openActivityLogsWindow: not running in Tauri");
    return;
  }

  const window = await getActivityLogsWindow();
  if (!window) {
    console.error(
      `openActivityLogsWindow: no webview with label "${ACTIVITY_LOGS_LABEL}"`,
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
    console.error("openActivityLogsWindow: failed to show logs window", err);
  }
}

export async function hideActivityLogsWindow(): Promise<void> {
  if (!isTauri()) return;

  const window = await getActivityLogsWindow();
  if (!window) return;

  try {
    await window.hide();
  } catch (err) {
    console.error("hideActivityLogsWindow:", err);
  }
}
