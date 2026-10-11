/**
 * Dev-only console helpers for skin-mode (view windows, reload).
 * Loaded from `skinBootstrap` / `skinAuxBootstrap` in DEV builds.
 */
import { reloadActiveSkinPack } from "./skinReload";
import { useSkinStore } from "../store/useSkinStore";

const SKIN_RELOAD_SHORTCUT = "Cmd+Shift+R (Ctrl+Shift+R on Windows/Linux)";

const SPIRAL_SKIN_DEV_HELP = `
spiralSkin — skin-mode dev helpers (DEV builds only)

  ${SKIN_RELOAD_SHORTCUT}               reload skin.json from disk
  await spiralSkin.reload()               same as the shortcut above
  await spiralSkin.toggleView("eq")       toggle auxiliary EQ window
  await spiralSkin.openView("playlist")   open resizable playlist window
  await spiralSkin.openView("vis")        open visualizer window
  await spiralSkin.closeView("vis")       close it
  await spiralSkin.switchView("mini")     primary window → exclusive mini
  await spiralSkin.switchView("main")     back to primary
  spiralSkin.state()                      current skin store snapshot
  spiralSkin.help()                       this message
`.trim();

declare global {
  interface Window {
    spiralSkin?: {
      reload: () => Promise<void>;
      switchView: (viewId: string) => Promise<void>;
      openView: (viewId: string) => Promise<void>;
      closeView: (viewId: string) => Promise<void>;
      toggleView: (viewId: string) => Promise<void>;
      state: () => ReturnType<typeof useSkinStore.getState>;
      help: () => void;
    };
  }
}

function isSkinReloadShortcut(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "r"
  );
}

function runSkinReload(): void {
  void reloadActiveSkinPack().catch((err: unknown) => {
    console.error("Skin reload failed:", err);
  });
}

export function installSkinDevConsole(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;

  window.spiralSkin = {
    reload: () => reloadActiveSkinPack(),
    switchView: (viewId) => useSkinStore.getState().switchView(viewId),
    openView: (viewId) => useSkinStore.getState().openView(viewId),
    closeView: (viewId) => useSkinStore.getState().closeView(viewId),
    toggleView: (viewId) => useSkinStore.getState().toggleView(viewId),
    state: () => useSkinStore.getState(),
    help: () => {
      console.info(SPIRAL_SKIN_DEV_HELP);
    },
  };

  window.addEventListener("keydown", (event) => {
    if (!isSkinReloadShortcut(event)) return;
    event.preventDefault();
    runSkinReload();
  });
}
