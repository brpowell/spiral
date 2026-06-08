import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import {
  currentMonitor,
  getCurrentWindow,
  type Color,
  type Window,
} from "@tauri-apps/api/window";
import type { LoadedSkinPack, SkinManifest, WindowChrome } from "../types/skin";
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
  maxWidth: 480,
  maxHeight: 720,
  resizable: true,
  snapEnabled: true,
};

export interface ResolvedSkinModeWindowChrome {
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  resizable: boolean;
  snapEnabled: boolean;
}

export function resolveSkinWindowChrome(
  manifest: SkinManifest | undefined,
): ResolvedSkinModeWindowChrome {
  const w: WindowChrome | undefined = manifest?.window;
  const defaultWidth =
    w?.defaultWidth ?? DEFAULT_SKIN_MODE_CHROME.defaultWidth;
  const defaultHeight =
    w?.defaultHeight ?? DEFAULT_SKIN_MODE_CHROME.defaultHeight;
  const minWidth = w?.minWidth ?? Math.min(defaultWidth, 240);
  const minHeight = w?.minHeight ?? Math.min(defaultHeight, 280);
  const maxWidth = w?.maxWidth ?? DEFAULT_SKIN_MODE_CHROME.maxWidth;
  const maxHeight = w?.maxHeight ?? DEFAULT_SKIN_MODE_CHROME.maxHeight;
  const resizable = w?.resizable ?? true;
  const snapEnabled = w?.snapEnabled ?? true;

  return {
    defaultWidth,
    defaultHeight,
    minWidth: Math.min(minWidth, defaultWidth, maxWidth),
    minHeight: Math.min(minHeight, defaultHeight, maxHeight),
    maxWidth: Math.max(maxWidth, defaultWidth, minWidth),
    maxHeight: Math.max(maxHeight, defaultHeight, minHeight),
    resizable,
    snapEnabled,
  };
}

export function resolvePackWindowChrome(
  pack: LoadedSkinPack | null,
): ResolvedSkinModeWindowChrome {
  if (!pack) return DEFAULT_SKIN_MODE_CHROME;
  return resolveSkinWindowChrome(pack.manifest);
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

function clampLogical(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

export function sanitizeWindowSize(
  width: number,
  height: number,
  chrome: ResolvedSkinModeWindowChrome,
): { width: number; height: number } {
  return {
    width: clampLogical(width, chrome.minWidth, chrome.maxWidth),
    height: clampLogical(height, chrome.minHeight, chrome.maxHeight),
  };
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
  await tryWindowOp("setMinSize", () =>
    window.setMinSize(new LogicalSize(chrome.minWidth, chrome.minHeight)),
  );
  await tryWindowOp("setMaxSize", () =>
    window.setMaxSize(new LogicalSize(chrome.maxWidth, chrome.maxHeight)),
  );
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
  const { width, height } = persisted
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

export async function applyPackWindowLayout(
  pack: LoadedSkinPack,
  window?: Window,
): Promise<void> {
  const chrome = resolvePackWindowChrome(pack);
  await applySkinModeWindowLayout(chrome, pack.summary.id, pack, window);
}

/** After switching skins, resize to the new skin's defaults if not resizable. */
export async function applySkinChangeWindowLayout(
  pack: LoadedSkinPack,
  window: Window = getCurrentWindow(),
): Promise<void> {
  const chrome = resolvePackWindowChrome(pack);
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

export async function readLogicalWindowSize(
  window: Window = getCurrentWindow(),
): Promise<{ width: number; height: number }> {
  const size = await window.innerSize();
  return { width: size.width, height: size.height };
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
