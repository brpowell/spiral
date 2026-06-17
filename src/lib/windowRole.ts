import { getCurrentWindow } from "@tauri-apps/api/window";

export type WindowRole = "main" | "skin-mode" | "appearance" | "activity-logs";

let role: WindowRole = "main";
let inTauri = false;

export async function bootstrapWindowRole(): Promise<WindowRole> {
  try {
    const label = getCurrentWindow().label;
    inTauri = true;
    if (label === "skin-mode") {
      role = "skin-mode";
    } else if (label === "appearance") {
      role = "appearance";
    } else if (label === "activity-logs") {
      role = "activity-logs";
    } else {
      role = "main";
    }
  } catch {
    inTauri = false;
    role = "main";
  }
  return role;
}

export function getWindowRole(): WindowRole {
  return role;
}

export function isSkinModeWindow(): boolean {
  return role === "skin-mode";
}

export function isAppearanceWindow(): boolean {
  return role === "appearance";
}

export function isActivityLogsWindow(): boolean {
  return role === "activity-logs";
}

export function isTauri(): boolean {
  return inTauri;
}
