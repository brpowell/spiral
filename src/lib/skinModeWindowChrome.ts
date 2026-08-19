import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import {
  currentMonitor,
  getCurrentWindow,
  type Color,
  type Window,
} from "@tauri-apps/api/window";
import type { LoadedSkinPack, WindowChrome } from "../types/skin";
import { resolveViewForPack } from "./skinViewState";
import { setSkinModeAlwaysOnTopSnapshot } from "./skinModeAlwaysOnTop";
import { restoreSkinModeGeometry } from "./skinModeSnap";
import {
  readPersistedSkinModeState,
  writePersistedSkinModeState,
  DEFAULT_SKIN_MODE_ALWAYS_ON_TOP,
  type PersistedSkinModeState,
} from "./skinModeWindowState";

/** Fallback when no skin manifest is available yet. */
export const DEFAULT_SKIN_MODE_CHROME: ResolvedSkinModeWindowChrome = {
  defaultWidth: 320,
  defaultHeight: 440,
  minWidth: 260,
  minHeight: 320,
  resizable: true,
  snapEnabled: true,
};

export interface ResolvedSkinModeWindowChrome {
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
  maxWidth?: number;
  maxHeight?: number;
  resizable: boolean;
  snapEnabled: boolean;
}

export function resolveWindowChrome(
  w: WindowChrome | undefined,
): ResolvedSkinModeWindowChrome {
  const defaultWidth = w?.defaultWidth ?? DEFAULT_SKIN_MODE_CHROME.defaultWidth;
  const defaultHeight =
    w?.defaultHeight ?? DEFAULT_SKIN_MODE_CHROME.defaultHeight;
  const minWidth = w?.minWidth ?? Math.min(defaultWidth, 240);
  const minHeight = w?.minHeight ?? Math.min(defaultHeight, 280);
  const maxWidth = w?.maxWidth;
  const maxHeight = w?.maxHeight;
  const resizable = w?.resizable ?? true;
  const snapEnabled = w?.snapEnabled ?? true;

  const resolvedMinWidth =
    maxWidth !== undefined
      ? Math.min(minWidth, defaultWidth, maxWidth)
      : Math.min(minWidth, defaultWidth);
  const resolvedMinHeight =
    maxHeight !== undefined
      ? Math.min(minHeight, defaultHeight, maxHeight)
      : Math.min(minHeight, defaultHeight);

  return {
    defaultWidth,
    defaultHeight,
    minWidth: resolvedMinWidth,
    minHeight: resolvedMinHeight,
    maxWidth:
      maxWidth !== undefined
        ? Math.max(maxWidth, defaultWidth, resolvedMinWidth)
        : undefined,
    maxHeight:
      maxHeight !== undefined
        ? Math.max(maxHeight, defaultHeight, resolvedMinHeight)
        : undefined,
    resizable,
    snapEnabled,
  };
}

export function resolveViewWindowChrome(
  pack: LoadedSkinPack,
  viewId: string,
): ResolvedSkinModeWindowChrome {
  return resolveWindowChrome(pack.manifest.views[viewId]?.window);
}

/** Min/max fields for Tauri window creation and `setSizeConstraints`. */
export function windowSizeLimitsFromChrome(
  chrome: ResolvedSkinModeWindowChrome,
): {
  minWidth: number;
  minHeight: number;
  maxWidth?: number;
  maxHeight?: number;
} {
  return {
    minWidth: chrome.minWidth,
    minHeight: chrome.minHeight,
    ...(chrome.maxWidth !== undefined ? { maxWidth: chrome.maxWidth } : {}),
    ...(chrome.maxHeight !== undefined ? { maxHeight: chrome.maxHeight } : {}),
  };
}

let snapSuppressedUntil = 0;
let activeSnapEnabled = true;

export function setSkinModeSnapEnabled(enabled: boolean): void {
  activeSnapEnabled = enabled;
}

export function isSkinModeSnapEnabled(): boolean {
  return activeSnapEnabled;
}

/** Skip edge-snap while the window is being positioned programmatically. */
export function suppressSkinModeSnap(durationMs = 900): void {
  snapSuppressedUntil = Date.now() + durationMs;
}

export function isSkinModeSnapSuppressed(): boolean {
  return Date.now() < snapSuppressedUntil;
}

/** Safety cap when manifest omits maxWidth/maxHeight (prevents runaway persisted sizes). */
const ABSOLUTE_MAX_WINDOW_DIMENSION = 4096;

function clampLogical(
  value: number,
  min: number,
  max: number | undefined,
): number {
  const clampedMin = Math.max(Math.round(value), min);
  return max !== undefined ? Math.min(clampedMin, max) : clampedMin;
}

export function sanitizeWindowSize(
  width: number,
  height: number,
  chrome: ResolvedSkinModeWindowChrome,
): { width: number; height: number } {
  const maxWidth = chrome.maxWidth ?? ABSOLUTE_MAX_WINDOW_DIMENSION;
  const maxHeight = chrome.maxHeight ?? ABSOLUTE_MAX_WINDOW_DIMENSION;
  return {
    width: clampLogical(width, chrome.minWidth, maxWidth),
    height: clampLogical(height, chrome.minHeight, maxHeight),
  };
}

export function isPlausibleWindowSize(
  width: number,
  height: number,
  chrome: ResolvedSkinModeWindowChrome,
): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;
  const maxWidth = chrome.maxWidth ?? ABSOLUTE_MAX_WINDOW_DIMENSION;
  const maxHeight = chrome.maxHeight ?? ABSOLUTE_MAX_WINDOW_DIMENSION;
  return width <= maxWidth && height <= maxHeight;
}

export function defaultWindowSize(chrome: ResolvedSkinModeWindowChrome): {
  width: number;
  height: number;
} {
  return {
    width: chrome.defaultWidth,
    height: chrome.defaultHeight,
  };
}

async function tryWindowOp(
  label: string,
  op: () => Promise<void>,
): Promise<void> {
  try {
    await op();
  } catch (err) {
    console.warn(`skin mode window: ${label} failed`, err);
  }
}

const SKIN_MODE_TRANSPARENT_BG: Color = "rgba(0, 0, 0, 0)";

/** Skin mode always uses a transparent native window (no OS title bar). */
export async function applySkinModeWindowPresentation(
  _pack: LoadedSkinPack | null,
  window: Window = getCurrentWindow(),
): Promise<void> {
  await tryWindowOp("setShadow", () => window.setShadow(false));
  await tryWindowOp("setBackgroundColor", () =>
    window.setBackgroundColor(SKIN_MODE_TRANSPARENT_BG),
  );
}

export async function applySkinModeWindowChrome(
  chrome: ResolvedSkinModeWindowChrome,
  window: Window = getCurrentWindow(),
): Promise<void> {
  suppressSkinModeSnap();

  await tryWindowOp("setResizable", () =>
    window.setResizable(chrome.resizable),
  );
  // Size constraints must succeed — without them the window falls back to the
  // weak tauri.conf.json floor (skin-mode is 200×120) and skins become unusable.
  try {
    await window.setSizeConstraints(windowSizeLimitsFromChrome(chrome));
  } catch (err) {
    console.error("skin mode window: setSizeConstraints failed", err);
    throw err;
  }
  setSkinModeSnapEnabled(chrome.snapEnabled);
}

export async function applySkinModeWindowLayout(
  chrome: ResolvedSkinModeWindowChrome,
  skinId: string,
  pack: LoadedSkinPack | null,
  window: Window = getCurrentWindow(),
): Promise<void> {
  suppressSkinModeSnap();
  await applySkinModeWindowPresentation(pack, window);
  await applySkinModeWindowChrome(chrome, window);

  const persisted = readPersistedSkinModeState(skinId);
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
    setSkinModeAlwaysOnTopSnapshot(persisted.alwaysOnTop);
  } else {
    await window.center();
    await window.setAlwaysOnTop(DEFAULT_SKIN_MODE_ALWAYS_ON_TOP);
    setSkinModeAlwaysOnTopSnapshot(DEFAULT_SKIN_MODE_ALWAYS_ON_TOP);
  }

  suppressSkinModeSnap();
}

export async function applyViewWindowLayout(
  pack: LoadedSkinPack,
  viewId: string,
  window: Window = getCurrentWindow(),
): Promise<void> {
  const chrome = resolveViewWindowChrome(pack, viewId);
  await applySkinModeWindowLayout(chrome, pack.summary.id, pack, window);
}

export async function applyPackWindowLayout(
  pack: LoadedSkinPack,
  viewIdOrWindow?: string | Window,
  maybeWindow?: Window,
): Promise<void> {
  let viewId: string;
  let window: Window | undefined;

  if (typeof viewIdOrWindow === "string") {
    viewId = viewIdOrWindow;
    window = maybeWindow;
  } else {
    viewId = resolveViewForPack(pack);
    window = viewIdOrWindow;
  }

  await applyViewWindowLayout(pack, viewId, window);
}

/** After switching skins, resize to the new skin's defaults if not resizable. */
export async function applySkinChangeWindowLayout(
  pack: LoadedSkinPack,
  viewId?: string,
  window: Window = getCurrentWindow(),
): Promise<void> {
  const resolvedViewId = viewId ?? resolveViewForPack(pack);
  const chrome = resolveViewWindowChrome(pack, resolvedViewId);
  suppressSkinModeSnap();
  await applySkinModeWindowPresentation(pack, window);
  await applySkinModeWindowChrome(chrome, window);

  if (!chrome.resizable) {
    const { width, height } = defaultWindowSize(chrome);
    await window.setSize(new LogicalSize(width, height));
    const persisted = readPersistedSkinModeState(pack.summary.id);
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
    }
  }

  suppressSkinModeSnap();
}

/** Resize the primary skin window when switching exclusive/primary views. */
export async function applySwitchViewWindowLayout(
  pack: LoadedSkinPack,
  viewId: string,
  window: Window = getCurrentWindow(),
): Promise<void> {
  const chrome = resolveViewWindowChrome(pack, viewId);
  suppressSkinModeSnap();
  await applySkinModeWindowPresentation(pack, window);
  await applySkinModeWindowChrome(chrome, window);

  const { width, height } = defaultWindowSize(chrome);
  await window.setSize(new LogicalSize(width, height));

  suppressSkinModeSnap();
}

export async function readLogicalWindowSize(
  window: Window = getCurrentWindow(),
): Promise<{ width: number; height: number }> {
  const [physicalSize, scaleFactor] = await Promise.all([
    window.innerSize(),
    window.scaleFactor(),
  ]);
  const logical = physicalSize.toLogical(scaleFactor);
  return { width: logical.width, height: logical.height };
}

export function buildPersistedState(
  skinId: string,
  partial: Omit<PersistedSkinModeState, "skinId" | "width" | "height"> & {
    width: number;
    height: number;
  },
): PersistedSkinModeState {
  return { skinId, ...partial };
}

export async function persistSkinModeStateForSkin(
  skinId: string,
  chrome: ResolvedSkinModeWindowChrome,
  snapPatch?: Partial<
    Pick<PersistedSkinModeState, "snapEdge" | "monitorName" | "scaleFactor">
  >,
  window: Window = getCurrentWindow(),
): Promise<void> {
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

  const previous = readPersistedSkinModeState(skinId);

  writePersistedSkinModeState(
    buildPersistedState(skinId, {
      x: position.x,
      y: position.y,
      width,
      height,
      alwaysOnTop,
      monitorName:
        snapPatch?.monitorName ??
        monitor?.name ??
        previous?.monitorName ??
        null,
      scaleFactor:
        snapPatch?.scaleFactor ??
        monitor?.scaleFactor ??
        previous?.scaleFactor ??
        1,
      snapEdge:
        snapPatch?.snapEdge !== undefined
          ? snapPatch.snapEdge
          : (previous?.snapEdge ?? null),
    }),
  );
}
