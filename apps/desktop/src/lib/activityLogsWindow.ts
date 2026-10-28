import { ensureAppWindow, releaseAppWindow } from "./appWindows";
import { applyCustomWindowChrome } from "./windowChrome";
import { isTauri } from "./windowRole";

const ACTIVITY_LOGS_LABEL = "activity-logs";

export async function openActivityLogsWindow(): Promise<void> {
  if (!isTauri()) {
    console.warn("openActivityLogsWindow: not running in Tauri");
    return;
  }

  const window = await ensureAppWindow(ACTIVITY_LOGS_LABEL);
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
    console.error("openActivityLogsWindow: failed to show logs window", err);
  }
}

export async function hideActivityLogsWindow(): Promise<void> {
  if (!isTauri()) return;
  await releaseAppWindow(ACTIVITY_LOGS_LABEL);
}
