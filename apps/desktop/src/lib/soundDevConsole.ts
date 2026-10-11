/**
 * Dev-only console helpers for the transport signature lab.
 * Loaded from `main.tsx` in DEV builds.
 */
import { openSoundLabWindow, toggleSoundLabWindow } from "./soundLabWindow";

const SPIRAL_SOUNDS_DEV_HELP = `
spiralSounds — transport signature helpers (DEV builds only)

  await spiralSounds.openLab()             open Sound Lab
  await spiralSounds.toggleLab()           open or close Sound Lab
  Developer → Sound Lab                    menu (⌘⌥S / Ctrl+Alt+S)
  spiralSounds.help()                      this message
`.trim();

declare global {
  interface Window {
    spiralSounds?: {
      openLab: () => Promise<void>;
      toggleLab: () => Promise<void>;
      help: () => void;
    };
  }
}

export function installSoundDevConsole(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;

  window.spiralSounds = {
    openLab: () => openSoundLabWindow(),
    toggleLab: () => toggleSoundLabWindow(),
    help: () => {
      console.info(SPIRAL_SOUNDS_DEV_HELP);
    },
  };
}
