import type { SnapEdge } from "./skinModeWindowState";

export interface PersistedSkinAuxWindowState {
  skinId: string;
  viewId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
  monitorName: string | null;
  scaleFactor: number;
  snapEdge: SnapEdge | null;
}

const STORAGE_KEY = "spiral:skin-aux-window";

interface StorageV1 {
  version: 1;
  byKey: Record<string, Omit<PersistedSkinAuxWindowState, "skinId" | "viewId">>;
}

function auxStorageKey(skinId: string, viewId: string): string {
  return `${skinId}:${viewId}`;
}

function readStorage(): StorageV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, byKey: {} };

    const parsed = JSON.parse(raw) as StorageV1;
    if (parsed.version === 1 && parsed.byKey) {
      return parsed;
    }
    return { version: 1, byKey: {} };
  } catch {
    return { version: 1, byKey: {} };
  }
}

function writeStorage(data: StorageV1): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function readPersistedSkinAuxWindowState(
  skinId: string,
  viewId: string,
): PersistedSkinAuxWindowState | null {
  const entry = readStorage().byKey[auxStorageKey(skinId, viewId)];
  if (!entry) return null;

  if (
    typeof entry.x !== "number" ||
    typeof entry.y !== "number" ||
    typeof entry.width !== "number" ||
    typeof entry.height !== "number"
  ) {
    return null;
  }

  return {
    skinId,
    viewId,
    x: entry.x,
    y: entry.y,
    width: entry.width,
    height: entry.height,
    alwaysOnTop: entry.alwaysOnTop === true,
    monitorName:
      typeof entry.monitorName === "string" ? entry.monitorName : null,
    scaleFactor: typeof entry.scaleFactor === "number" ? entry.scaleFactor : 1,
    snapEdge:
      entry.snapEdge === "left" ||
      entry.snapEdge === "right" ||
      entry.snapEdge === "top" ||
      entry.snapEdge === "bottom"
        ? entry.snapEdge
        : null,
  };
}

export function writePersistedSkinAuxWindowState(
  state: PersistedSkinAuxWindowState,
): void {
  const stored = readStorage();
  const { skinId, viewId, ...rest } = state;
  stored.byKey[auxStorageKey(skinId, viewId)] = rest;
  writeStorage(stored);
}
