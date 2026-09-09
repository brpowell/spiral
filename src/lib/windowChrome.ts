import { getCurrentWindow, type Window } from "@tauri-apps/api/window";

export type DesktopPlatform = "macos" | "windows" | "linux" | "unknown";

/** Minimal surface shared by `Window` / `WebviewWindow` for chrome setup. */
type WindowChromeTarget = Pick<Window, "setDecorations" | "setShadow">;

export function getDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return "macos";
  if (/Win/i.test(ua)) return "windows";
  if (/Linux/i.test(ua)) return "linux";
  return "unknown";
}

/**
 * True when library / Studio / EQ / logs / About should use the in-app title bar.
 * macOS keeps the system menu bar / traffic lights.
 */
export function usesCustomWindowChrome(): boolean {
  const platform = getDesktopPlatform();
  return platform === "windows" || platform === "linux";
}

/**
 * Strip native decorations (and request a compositor shadow where supported).
 * On Linux, call after the window is visible — GTK often ignores decoration
 * changes while still hidden.
 */
export async function applyCustomWindowChrome(
  target?: WindowChromeTarget,
): Promise<void> {
  if (!usesCustomWindowChrome()) return;
  try {
    const window = target ?? getCurrentWindow();
    await window.setDecorations(false);
    try {
      await window.setShadow(true);
    } catch {
      // Optional platform support.
    }
  } catch (err) {
    console.warn("Failed to apply custom window chrome:", err);
  }
}
