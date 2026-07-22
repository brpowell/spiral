import { getCurrentWindow } from "@tauri-apps/api/window";

export type DesktopPlatform = "macos" | "windows" | "linux" | "unknown";

/**
 * Platforms that use an in-app title bar instead of OS decorations + menu bar.
 * macOS keeps the system menu bar / traffic lights.
 *
 * Linux (esp. Ubuntu with a classic menubar) has the same chrome mismatch —
 * add `"linux"` here when polishing Linux.
 */
const CUSTOM_WINDOW_CHROME_PLATFORMS: ReadonlySet<DesktopPlatform> = new Set([
  "windows",
  // "linux",
]);

export function getDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return "macos";
  if (/Win/i.test(ua)) return "windows";
  if (/Linux/i.test(ua)) return "linux";
  return "unknown";
}

/** True when library / Studio / EQ / logs should use the in-app title bar. */
export function usesCustomWindowChrome(): boolean {
  return CUSTOM_WINDOW_CHROME_PLATFORMS.has(getDesktopPlatform());
}

/**
 * Strip native decorations (and keep a Win11-friendly shadow) on custom-chrome
 * platforms. Safe to call once at startup for the current window.
 */
export async function applyCustomWindowChrome(): Promise<void> {
  if (!usesCustomWindowChrome()) return;
  try {
    const window = getCurrentWindow();
    await window.setDecorations(false);
    // Windows: enables shadow + Win11 rounded corners on undecorated windows.
    try {
      await window.setShadow(true);
    } catch {
      // Optional; older WebView2 / missing ACL should not block chrome.
    }
  } catch (err) {
    console.warn("Failed to apply custom window chrome:", err);
  }
}
