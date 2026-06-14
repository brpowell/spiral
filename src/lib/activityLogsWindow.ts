import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
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
