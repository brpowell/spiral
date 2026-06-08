export type SnapEdge = "left" | "right" | "top" | "bottom";

export const DEFAULT_SKIN_MODE_ALWAYS_ON_TOP = true;

export interface PersistedSkinModeState {
  skinId: string;
  /** Physical screen coordinates. */
  x: number;
  y: number;
  /** Logical pixels (matches Tauri `innerSize` / `LogicalSize`). */
  width: number;
  height: number;
  alwaysOnTop: boolean;
  monitorName: string | null;
  scaleFactor: number;
  snapEdge: SnapEdge | null;
}

const STORAGE_KEY = "spiral:skin-mode-window";

interface StorageV2 {
  version: 2;
  bySkin: Record<string, Omit<PersistedSkinModeState, "skinId">>;
}

function readStorage(): StorageV2 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 2, bySkin: {} };

    const parsed = JSON.parse(raw) as StorageV2;
    if (parsed.version === 2 && parsed.bySkin) {
      return parsed;
    }

    return { version: 2, bySkin: {} };
  } catch {
    return { version: 2, bySkin: {} };
  }
}

function writeStorage(data: StorageV2): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function readPersistedSkinModeState(
  skinId: string,
): PersistedSkinModeState | null {
  const stored = readStorage();
  const entry = stored.bySkin[skinId];
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

export function writePersistedSkinModeState(
  state: PersistedSkinModeState,
): void {
  const stored = readStorage();
  const { skinId, ...rest } = state;
  stored.bySkin[skinId] = rest;
  writeStorage(stored);
}

export function patchPersistedSkinModeState(
  skinId: string,
  patch: Partial<Omit<PersistedSkinModeState, "skinId">>,
): PersistedSkinModeState | null {
  const current = readPersistedSkinModeState(skinId);
  if (!current) return null;
  const next = { ...current, ...patch };
  writePersistedSkinModeState(next);
  return next;
}
