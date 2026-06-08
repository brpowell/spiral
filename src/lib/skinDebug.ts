export const SKIN_DEBUG_STORAGE_KEY = "spiral:skinDebug";
export const SKIN_DEBUG_CHANGE_EVENT = "spiral:skinDebug";

export function isSkinDebugEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem(SKIN_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSkinDebugEnabled(enabled: boolean): void {
  if (!import.meta.env.DEV) return;
  try {
    localStorage.setItem(SKIN_DEBUG_STORAGE_KEY, enabled ? "1" : "0");
    window.dispatchEvent(new Event(SKIN_DEBUG_CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

export function toggleSkinDebug(): boolean {
  const next = !isSkinDebugEnabled();
  setSkinDebugEnabled(next);
  return next;
}

declare global {
  interface Window {
    spiralSkinDebug?: {
      enable: () => void;
      disable: () => void;
      toggle: () => boolean;
    };
  }
}

if (import.meta.env.DEV) {
  window.spiralSkinDebug = {
    enable: () => setSkinDebugEnabled(true),
    disable: () => setSkinDebugEnabled(false),
    toggle: toggleSkinDebug,
  };
}
