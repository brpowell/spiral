import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  currentMonitor,
  getCurrentWindow,
  type Window,
} from "@tauri-apps/api/window";
import type { LoadedSkinPack } from "../types/skin";
import {
  addOpenAuxView,
  readOpenAuxViewsForSkin,
  removeOpenAuxView,
  writeOpenAuxViewsForSkin,
} from "./skinAuxViewState";
import {
  buildSkinAuxWindowUrl,
  parseSkinAuxWindowLabel,
  skinAuxWindowLabel,
  SKIN_AUX_LABEL_PREFIX,
} from "./skinAuxContext";
import { signalSkinAuxViewReset } from "./skinAuxEvents";
import { createSkinAuxReadyWait } from "./skinAuxReady";
import {
  readPersistedSkinAuxWindowState,
  writePersistedSkinAuxWindowState,
  type PersistedSkinAuxWindowState,
} from "./skinAuxWindowState";
import {
  applySkinModeWindowChrome,
  applySkinModeWindowPresentation,
  defaultWindowSize,
  isPlausibleWindowSize,
  readLogicalWindowSize,
  resolveViewWindowChrome,
  sanitizeWindowSize,
  suppressSkinModeSnap,
  windowSizeLimitsFromChrome,
} from "./skinModeWindowChrome";
import { restoreSkinModeGeometry } from "./skinModeSnap";
import { DEFAULT_SKIN_MODE_ALWAYS_ON_TOP } from "./skinModeWindowState";
import { isTauri } from "./windowRole";
import { isAuxiliaryView } from "./skinWindowPresentation";

const openingAuxWindows = new Map<string, Promise<void>>();

function auxWindowKey(skinId: string, viewId: string): string {
  return `${skinId}:${viewId}`;
}

async function waitForSkinAuxWebview(
  skinId: string,
  viewId: string,
  webview: WebviewWindow,
): Promise<WebviewWindow> {
  const immediate = await getSkinAuxWindow(skinId, viewId);
  if (immediate) {
    return immediate;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (window: WebviewWindow | null) => {
      if (settled || !window) return;
      settled = true;
      resolve(window);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    webview.once("tauri://created", () => {
      void getSkinAuxWindow(skinId, viewId).then(finish);
    });
    webview.once("tauri://error", (event) => {
      fail(new Error(String(event.payload)));
    });

    void getSkinAuxWindow(skinId, viewId).then(finish);

    void (async () => {
      for (let attempt = 0; attempt < 120 && !settled; attempt++) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        if (settled) return;
        const window = await getSkinAuxWindow(skinId, viewId);
        if (window) {
          finish(window);
          return;
        }
      }
      if (!settled) {
        fail(new Error(`Timed out waiting for aux window "${viewId}"`));
      }
    })();
  });
}

async function revealSkinAuxWindow(
  pack: LoadedSkinPack,
  viewId: string,
  window: WebviewWindow,
  options?: { deferShow?: boolean },
): Promise<void> {
  await applyAuxWindowLayout(pack, viewId, window);
  if (options?.deferShow) return;
  addOpenAuxView(pack.summary.id, viewId);
  await window.show();
  await window.setFocus();
}

async function openSkinAuxWindowInner(
  pack: LoadedSkinPack,
  viewId: string,
  options?: { prewarm?: boolean },
): Promise<void> {
  const skinId = pack.summary.id;
  const existing = await getSkinAuxWindow(skinId, viewId);
  if (existing) {
    const visible = await existing.isVisible();
    if (options?.prewarm) return;
    if (visible) {
      const minimized = await existing.isMinimized();
      if (minimized) await existing.unminimize();
      await existing.setFocus();
      return;
    }
    await revealSkinAuxWindow(pack, viewId, existing);
    return;
  }

  const label = skinAuxWindowLabel(skinId, viewId);
  const chrome = resolveViewWindowChrome(pack, viewId);
  const { width, height } = defaultWindowSize(chrome);

  const readyWait = await createSkinAuxReadyWait(skinId, viewId);

  const webview = new WebviewWindow(label, {
    url: buildSkinAuxWindowUrl(skinId, viewId),
    title: `${pack.manifest.name} — ${viewId}`,
    width,
    height,
    ...windowSizeLimitsFromChrome(chrome),
    resizable: chrome.resizable,
    decorations: false,
    transparent: true,
    shadow: false,
    visible: false,
    dragDropEnabled: false,
    acceptFirstMouse: true,
  });

  const ready = await waitForSkinAuxWebview(skinId, viewId, webview);
  await revealSkinAuxWindow(pack, viewId, ready, { deferShow: true });

  try {
    await readyWait.wait;
  } catch (err) {
    console.warn(
      `Aux view "${viewId}" did not signal ready before show; continuing`,
      err,
    );
  } finally {
    readyWait.cancel();
  }

  if (options?.prewarm) return;

  addOpenAuxView(skinId, viewId);
  await ready.show();
  await ready.setFocus();
}

async function getSkinAuxWindow(
  skinId: string,
  viewId: string,
): Promise<WebviewWindow | null> {
  try {
    return await WebviewWindow.getByLabel(skinAuxWindowLabel(skinId, viewId));
  } catch {
    return null;
  }
}

/** Whether an auxiliary skin view window exists and is currently visible. */
export async function isSkinAuxViewOpen(
  skinId: string,
  viewId: string,
): Promise<boolean> {
  if (!isTauri()) return false;

  try {
    const window = await getSkinAuxWindow(skinId, viewId);
    if (!window) return false;
    return await window.isVisible();
  } catch {
    return false;
  }
}

export async function applySkinAuxViewWindowLayout(
  pack: LoadedSkinPack,
  viewId: string,
  window: Window = getCurrentWindow(),
): Promise<void> {
  await applyAuxWindowLayout(pack, viewId, window);
}

async function applyAuxWindowLayout(
  pack: LoadedSkinPack,
  viewId: string,
  window: Window,
): Promise<void> {
  const chrome = resolveViewWindowChrome(pack, viewId);
  suppressSkinModeSnap();
  await applySkinModeWindowPresentation(pack, window);
  await applySkinModeWindowChrome(chrome, window);

  const persisted = readPersistedSkinAuxWindowState(pack.summary.id, viewId);
  const { width, height } =
    persisted &&
    isPlausibleWindowSize(persisted.width, persisted.height, chrome)
      ? sanitizeWindowSize(persisted.width, persisted.height, chrome)
      : defaultWindowSize(chrome);

  await window.setSize(new LogicalSize(width, height));

  if (persisted) {
    const { x, y } = await restoreSkinModeGeometry(
      persisted.monitorName,
      persisted.x,
      persisted.y,
      width,
      height,
      chrome.snapEnabled ? persisted.snapEdge : null,
    );
    await window.setPosition(new PhysicalPosition(x, y));
    await window.setAlwaysOnTop(persisted.alwaysOnTop);
  } else {
    await window.center();
    await window.setAlwaysOnTop(DEFAULT_SKIN_MODE_ALWAYS_ON_TOP);
  }

  suppressSkinModeSnap();
}

export async function openSkinAuxWindow(
  pack: LoadedSkinPack,
  viewId: string,
): Promise<void> {
  if (!isTauri()) return;

  const key = auxWindowKey(pack.summary.id, viewId);
  const inFlight = openingAuxWindows.get(key);
  if (inFlight) {
    await inFlight;
    return;
  }

  const work = openSkinAuxWindowInner(pack, viewId);
  openingAuxWindows.set(key, work);
  try {
    await work;
  } finally {
    openingAuxWindows.delete(key);
  }
}

/** Create hidden aux webviews while skin mode is open so first open feels instant. */
export async function prewarmSkinAuxWindows(
  pack: LoadedSkinPack,
): Promise<void> {
  if (!isTauri()) return;

  const auxViewIds = Object.keys(pack.manifest.views).filter((viewId) =>
    isAuxiliaryView(pack, viewId),
  );

  await Promise.all(
    auxViewIds.map(async (viewId) => {
      try {
        await openSkinAuxWindowInner(pack, viewId, { prewarm: true });
      } catch (err) {
        console.warn(`Failed to prewarm aux view "${viewId}":`, err);
      }
    }),
  );
}

export async function closeSkinAuxWindow(
  pack: LoadedSkinPack,
  viewId: string,
): Promise<void> {
  if (!isTauri()) return;

  const skinId = pack.summary.id;
  const window = await getSkinAuxWindow(skinId, viewId);
  if (!window) {
    removeOpenAuxView(skinId, viewId);
    return;
  }

  try {
    await persistSkinAuxWindowState(pack, viewId, window);
  } catch (err) {
    console.warn("closeSkinAuxWindow: failed to persist geometry", err);
  }

  removeOpenAuxView(skinId, viewId);
  openingAuxWindows.delete(auxWindowKey(skinId, viewId));

  signalSkinAuxViewReset(skinId, viewId);

  try {
    await window.hide();
  } catch {
    /* already hidden or destroyed */
  }
}

export async function closeAllSkinAuxWindows(
  pack?: LoadedSkinPack,
): Promise<void> {
  if (!isTauri()) return;

  const skinId = pack?.summary.id;
  const windows = await WebviewWindow.getAll();
  const auxWindows = windows.filter((window) =>
    window.label.startsWith(SKIN_AUX_LABEL_PREFIX),
  );

  for (const window of auxWindows) {
    const context = parseSkinAuxWindowLabel(window.label);
    if (!context) continue;
    if (skinId && context.skinId !== skinId) continue;

    if (pack && context.viewId in pack.manifest.views) {
      try {
        await persistSkinAuxWindowState(pack, context.viewId, window);
      } catch {
        /* ignore */
      }
    }
    removeOpenAuxView(context.skinId, context.viewId);
    try {
      await window.destroy();
    } catch {
      /* already destroyed */
    }
  }

  if (skinId) {
    writeOpenAuxViewsForSkin(skinId, []);
  }
}

function readRestorableOpenAuxViews(pack: LoadedSkinPack): string[] {
  const skinId = pack.summary.id;
  const openViewIds = readOpenAuxViewsForSkin(skinId);
  const allAuxViewIds = Object.keys(pack.manifest.views).filter((viewId) =>
    isAuxiliaryView(pack, viewId),
  );

  // Prewarm used to mark every auxiliary view as open while keeping them hidden.
  if (
    allAuxViewIds.length > 0 &&
    allAuxViewIds.every((viewId) => openViewIds.includes(viewId))
  ) {
    writeOpenAuxViewsForSkin(skinId, []);
    return [];
  }

  return openViewIds;
}

export async function restoreOpenSkinAuxWindows(
  pack: LoadedSkinPack,
): Promise<void> {
  if (!isTauri()) return;

  const openViewIds = readRestorableOpenAuxViews(pack);
  await Promise.all(
    openViewIds.map(async (viewId) => {
      const view = pack.manifest.views[viewId];
      if (!view || view.presentation !== "auxiliary") {
        removeOpenAuxView(pack.summary.id, viewId);
        return;
      }
      try {
        await openSkinAuxWindow(pack, viewId);
      } catch (err) {
        console.error(`Failed to restore aux view "${viewId}":`, err);
        removeOpenAuxView(pack.summary.id, viewId);
      }
    }),
  );
}

export async function persistSkinAuxWindowState(
  pack: LoadedSkinPack,
  viewId: string,
  window: Window,
): Promise<void> {
  const chrome = resolveViewWindowChrome(pack, viewId);

  const [position, logicalSize, monitor, alwaysOnTop] = await Promise.all([
    window.outerPosition(),
    readLogicalWindowSize(window),
    currentMonitor(),
    window.isAlwaysOnTop(),
  ]);

  const { width, height } = sanitizeWindowSize(
    logicalSize.width,
    logicalSize.height,
    chrome,
  );

  const previous = readPersistedSkinAuxWindowState(pack.summary.id, viewId);

  writePersistedSkinAuxWindowState({
    skinId: pack.summary.id,
    viewId,
    x: position.x,
    y: position.y,
    width,
    height,
    alwaysOnTop,
    monitorName: monitor?.name ?? previous?.monitorName ?? null,
    scaleFactor: monitor?.scaleFactor ?? previous?.scaleFactor ?? 1,
    snapEdge: previous?.snapEdge ?? null,
  } satisfies PersistedSkinAuxWindowState);
}
