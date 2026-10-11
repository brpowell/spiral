import { getCurrentWindow, type Window } from "@tauri-apps/api/window";

export type DesktopPlatform = "macos" | "windows" | "linux" | "unknown";

/** Minimal surface shared by `Window` / `WebviewWindow` for chrome setup. */
type WindowChromeTarget = Pick<
  Window,
  "setDecorations" | "setShadow" | "setTitleBarStyle"
>;

export function getDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return "macos";
  if (/Win/i.test(ua)) return "windows";
  if (/Linux/i.test(ua)) return "linux";
  return "unknown";
}

/**
 * Windows/Linux draw min/max/close themselves.
 * macOS keeps native traffic lights and paints under them instead.
 */
export function usesCustomWindowChrome(): boolean {
  const platform = getDesktopPlatform();
  return platform === "windows" || platform === "linux";
}

/** macOS overlay title bar: themed content, native traffic lights. */
export function usesMacOverlayChrome(): boolean {
  return getDesktopPlatform() === "macos";
}

/**
 * Apply the platform window chrome.
 * Windows/Linux drop native decorations. macOS uses an overlay title bar so
 * the webview paints the theme under the traffic lights.
 * On Linux, call after the window is visible — GTK often ignores decoration
 * changes while still hidden.
 */
export async function applyCustomWindowChrome(
  target?: WindowChromeTarget,
): Promise<void> {
  const platform = getDesktopPlatform();
  if (platform !== "macos" && platform !== "windows" && platform !== "linux") {
    return;
  }
  try {
    const window = target ?? getCurrentWindow();
    if (platform === "macos") {
      await window.setDecorations(true);
      await window.setTitleBarStyle("overlay");
      return;
    }
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
