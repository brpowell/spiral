import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import {
  closeAllSkinAuxWindows,
  prewarmSkinAuxWindows,
  restoreOpenSkinAuxWindows,
} from "./skinAuxWindow";
import {
  applyPackWindowLayout,
  persistSkinModeStateForSkin,
  resolveViewWindowChrome,
  suppressSkinModeSnap,
} from "./skinModeWindowChrome";
import { resolveViewForPack } from "./skinViewState";
import { useSkinStore } from "../store/useSkinStore";
import { getActiveSkinId, loadSkinPack, quitApp } from "./tauri";
import {
  patchPersistedSkinModeState,
  readPersistedSkinModeState,
  DEFAULT_SKIN_MODE_ALWAYS_ON_TOP,
} from "./skinModeWindowState";
import { PLAYER_REQUEST_STATE_EVENT } from "./playerStoreBridge";
import { setSkinModeAlwaysOnTopSnapshot } from "./skinModeAlwaysOnTop";
import { setSkinModeSessionActive } from "./listenSession";
import { isTauri } from "./windowRole";

export { DEFAULT_SKIN_MODE_ALWAYS_ON_TOP } from "./skinModeWindowState";

const SKIN_MODE_LABEL = "skin-mode";
const MAIN_WINDOW_LABEL = "main";

/** Fired in the skin-mode webview after the window is shown (intro timers, etc.). */
export const SKIN_MODE_SHOWN_EVENT = "spiral:skin-mode-shown";

async function getSkinModeWindow(): Promise<WebviewWindow | null> {
  try {
    return await WebviewWindow.getByLabel(SKIN_MODE_LABEL);
  } catch {
    return null;
  }
}

async function getMainWindow(): Promise<WebviewWindow | null> {
  try {
    return await WebviewWindow.getByLabel(MAIN_WINDOW_LABEL);
  } catch {
    return null;
  }
}

export async function openSkinMode(): Promise<void> {
  if (!isTauri()) {
    console.warn("openSkinMode: not running in Tauri");
    return;
  }

  const [skinModeWindow, main] = await Promise.all([
    getSkinModeWindow(),
    getMainWindow(),
  ]);

  if (!skinModeWindow) {
    console.error(
      `openSkinMode: no webview with label "${SKIN_MODE_LABEL}"`,
    );
    return;
  }

  try {
    const skinId = await getActiveSkinId();
    const pack = await loadSkinPack(skinId);
    const viewId = resolveViewForPack(pack);
    await applyPackWindowLayout(pack, viewId, skinModeWindow);

    await skinModeWindow.show();
    if (main) {
      await main.hide();
    }
    setSkinModeSessionActive(true);
    suppressSkinModeSnap();
    await skinModeWindow.setFocus();
    void emit(SKIN_MODE_SHOWN_EVENT, {});
    void emit(PLAYER_REQUEST_STATE_EVENT, {});
    await restoreOpenSkinAuxWindows(pack);
    void prewarmSkinAuxWindows(pack).catch((err: unknown) => {
      console.warn("prewarmSkinAuxWindows failed:", err);
    });
  } catch (err) {
    console.error("openSkinMode: failed to show skin mode window", err);
  }
}

/** Exit skin mode: hide the skin window and show the main library window again. */
export async function restoreMainWindow(): Promise<void> {
  if (!isTauri()) return;

  const pack = await loadSkinPack(await getActiveSkinId()).catch(() => null);

  const [main, skinModeWindow] = await Promise.all([
    getMainWindow(),
    getSkinModeWindow(),
  ]);

  if (pack) {
    await closeAllSkinAuxWindows(pack);
  } else {
    await closeAllSkinAuxWindows();
  }

  if (skinModeWindow) {
    await skinModeWindow.hide();
  }

  setSkinModeSessionActive(false);

  if (main) {
    const minimized = await main.isMinimized();
    if (minimized) {
      await main.unminimize();
    }
    await main.show();
    await main.setFocus();
  }
}

export async function exitSkinMode(): Promise<void> {
  await restoreMainWindow();
}

/** Minimize the skin-mode window (WMP-style chrome minus button). */
export async function minimizeSkinMode(): Promise<void> {
  if (!isTauri()) return;

  const window = getCurrentWindow();
  if (window.label !== SKIN_MODE_LABEL) return;

  await window.minimize();
}

/** Quit Spiral (persists playback session on main, then exits the process). */
export async function quitApplication(): Promise<void> {
  if (!isTauri()) return;

  const main = await getMainWindow();
  if (main) {
    await main.close();
    return;
  }

  await quitApp();
}

export async function readSkinModeAlwaysOnTop(
  skinId?: string,
): Promise<boolean> {
  if (skinId) {
    return (
      readPersistedSkinModeState(skinId)?.alwaysOnTop ??
      DEFAULT_SKIN_MODE_ALWAYS_ON_TOP
    );
  }
  try {
    const id = await getActiveSkinId();
    return (
      readPersistedSkinModeState(id)?.alwaysOnTop ??
      DEFAULT_SKIN_MODE_ALWAYS_ON_TOP
    );
  } catch {
    return DEFAULT_SKIN_MODE_ALWAYS_ON_TOP;
  }
}

export async function setSkinModeAlwaysOnTop(
  alwaysOnTop: boolean,
  skinId?: string,
): Promise<void> {
  if (!isTauri()) return;

  const window = getCurrentWindow();
  if (window.label !== SKIN_MODE_LABEL) return;

  await window.setAlwaysOnTop(alwaysOnTop);
  setSkinModeAlwaysOnTopSnapshot(alwaysOnTop);

  const resolvedSkinId =
    skinId ?? (await getActiveSkinId().catch(() => "spiral-default"));

  if (patchPersistedSkinModeState(resolvedSkinId, { alwaysOnTop })) {
    return;
  }

  const pack = await loadSkinPack(resolvedSkinId).catch(() => null);
  if (!pack) return;
  const viewId = useSkinStore.getState().activeViewId;
  const chrome = resolveViewWindowChrome(pack, viewId);
  await persistSkinModeStateForSkin(resolvedSkinId, chrome);
}

export async function persistSkinModeWindowState(
  skinId: string,
  snapResult?: Partial<{
    snapEdge: import("./skinModeWindowState").SnapEdge | null;
    monitorName: string | null;
    scaleFactor: number;
  }>,
): Promise<void> {
  if (!isTauri()) return;

  const window = getCurrentWindow();
  if (window.label !== SKIN_MODE_LABEL) return;

  const pack = await loadSkinPack(skinId).catch(() => null);
  if (!pack) return;
  const viewId = useSkinStore.getState().activeViewId;
  const chrome = resolveViewWindowChrome(pack, viewId);
  await persistSkinModeStateForSkin(skinId, chrome, snapResult, window);
}

export async function isSkinModeVisible(): Promise<boolean> {
  if (!isTauri()) return false;
  const window = await getSkinModeWindow();
  if (!window) return false;
  return window.isVisible();
}

export async function ensureSkinModeOnVisibleMonitor(): Promise<void> {
  if (!isTauri()) return;

  const window = getCurrentWindow();
  if (window.label !== SKIN_MODE_LABEL) return;

  const [position, size] = await Promise.all([
    window.outerPosition(),
    window.outerSize(),
  ]);
  const monitors = await availableMonitors();
  const centerX = position.x + size.width / 2;
  const centerY = position.y + size.height / 2;

  const onMonitor = monitors.some((monitor) => {
    const { x, y } = monitor.position;
    return (
      centerX >= x &&
      centerX <= x + monitor.size.width &&
      centerY >= y &&
      centerY <= y + monitor.size.height
    );
  });

  if (!onMonitor) {
    suppressSkinModeSnap();
    await window.center();
    suppressSkinModeSnap();
  }
}
