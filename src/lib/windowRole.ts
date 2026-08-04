import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  parseSkinAuxContextFromUrl,
  parseSkinAuxWindowLabel,
  type SkinAuxContext,
} from "./skinAuxContext";

export type WindowRole =
  | "main"
  | "skin-mode"
  | "skin-aux"
  | "appearance"
  | "equalizer"
  | "activity-logs"
  | "toast-lab";

let role: WindowRole = "main";
let skinAuxContext: SkinAuxContext | null = null;
let inTauri = false;

export async function bootstrapWindowRole(): Promise<WindowRole> {
  try {
    const label = getCurrentWindow().label;
    inTauri = true;
    if (label === "skin-mode") {
      role = "skin-mode";
    } else if (label.startsWith("skin-aux-")) {
      role = "skin-aux";
      skinAuxContext =
        parseSkinAuxWindowLabel(label) ?? parseSkinAuxContextFromUrl();
    } else if (label === "appearance") {
      role = "appearance";
    } else if (label === "equalizer") {
      role = "equalizer";
    } else if (label === "activity-logs") {
      role = "activity-logs";
    } else if (label === "toast-lab") {
      role = "toast-lab";
    } else {
      role = "main";
    }
  } catch {
    inTauri = false;
    skinAuxContext = null;
    // Browser / Vite-only: allow ?toast-lab=1 for the design lab.
    role =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("toast-lab") === "1"
        ? "toast-lab"
        : "main";
  }
  return role;
}

export function getWindowRole(): WindowRole {
  return role;
}

export function getSkinAuxContext(): SkinAuxContext | null {
  return skinAuxContext;
}

export function isSkinModeWindow(): boolean {
  return role === "skin-mode";
}

export function isSkinAuxWindow(): boolean {
  return role === "skin-aux";
}

export function isAnySkinWindow(): boolean {
  return role === "skin-mode" || role === "skin-aux";
}

export function isAppearanceWindow(): boolean {
  return role === "appearance";
}

export function isEqualizerWindow(): boolean {
  return role === "equalizer";
}

export function isActivityLogsWindow(): boolean {
  return role === "activity-logs";
}

export function isToastLabWindow(): boolean {
  return role === "toast-lab";
}

export function isTauri(): boolean {
  return inTauri;
}
