/**
 * Dev-only console helpers for the toast design lab.
 * Loaded from `main.tsx` in DEV builds.
 */
import { openToastLabWindow, toggleToastLabWindow } from "./toastLabWindow";

const SPIRAL_TOASTS_DEV_HELP = `
spiralToasts — toast design helpers (DEV builds only)

  await spiralToasts.openLab()            open the Toast Lab window
  await spiralToasts.toggleLab()          open or close the Toast Lab
  Developer → Toast Lab                   menu (⌘⇧T / Ctrl+Shift+T)
  spiralToasts.help()                     this message
`.trim();

declare global {
  interface Window {
    spiralToasts?: {
      openLab: () => Promise<void>;
      toggleLab: () => Promise<void>;
      help: () => void;
    };
  }
}

export function installToastDevConsole(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;

  window.spiralToasts = {
    openLab: () => openToastLabWindow(),
    toggleLab: () => toggleToastLabWindow(),
    help: () => {
      console.info(SPIRAL_TOASTS_DEV_HELP);
    },
  };
}
