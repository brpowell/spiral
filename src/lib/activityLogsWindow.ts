import { emit } from "@tauri-apps/api/event";
import { ensureAppWindow, releaseAppWindow } from "./appWindows";
import { applyCustomWindowChrome } from "./windowChrome";
import { isTauri } from "./windowRole";

const ACTIVITY_LOGS_LABEL = "activity-logs";

export const ACTIVITY_LOGS_REVEAL_EVENT = "activity-logs://reveal";

/** Target for deep-linking into the activity logs panel. */
export interface ActivityLogRevealTarget {
  entryId?: string;
  operationId?: string;
}

export async function openActivityLogsWindow(
  target?: ActivityLogRevealTarget,
): Promise<void> {
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

    if (target?.entryId != null || target?.operationId != null) {
      void emit(ACTIVITY_LOGS_REVEAL_EVENT, target);
    }
  } catch (err) {
    console.error("openActivityLogsWindow: failed to show logs window", err);
  }
}

export async function hideActivityLogsWindow(): Promise<void> {
  if (!isTauri()) return;
  await releaseAppWindow(ACTIVITY_LOGS_LABEL);
}
