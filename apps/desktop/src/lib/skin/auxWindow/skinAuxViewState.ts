const OPEN_AUX_KEY = "spiral:skin-open-aux-views";

function readOpenMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(OPEN_AUX_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const map: Record<string, string[]> = {};
    for (const [skinId, viewIds] of Object.entries(parsed)) {
      if (Array.isArray(viewIds)) {
        map[skinId] = viewIds.filter(
          (id): id is string => typeof id === "string",
        );
      }
    }
    return map;
  } catch {
    return {};
  }
}

const localListeners = new Set<() => void>();

function writeOpenMap(map: Record<string, string[]>): void {
  const next = JSON.stringify(map);
  if (localStorage.getItem(OPEN_AUX_KEY) === next) return;
  localStorage.setItem(OPEN_AUX_KEY, next);
  for (const listener of localListeners) listener();
}

/**
 * Calls `listener` when the open views change, whether this window or another
 * one wrote them (`storage` events only reach the other windows).
 */
export function subscribeOpenAuxViews(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    // A null key means the whole storage area was cleared.
    if (event.key === OPEN_AUX_KEY || event.key === null) listener();
  };
  localListeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    localListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function readOpenAuxViewsForSkin(skinId: string): string[] {
  return readOpenMap()[skinId] ?? [];
}

export function writeOpenAuxViewsForSkin(
  skinId: string,
  viewIds: readonly string[],
): void {
  const map = readOpenMap();
  if (viewIds.length === 0) {
    delete map[skinId];
  } else {
    map[skinId] = [...viewIds];
  }
  writeOpenMap(map);
}

export function addOpenAuxView(skinId: string, viewId: string): void {
  const current = readOpenAuxViewsForSkin(skinId);
  if (current.includes(viewId)) return;
  writeOpenAuxViewsForSkin(skinId, [...current, viewId]);
}

export function removeOpenAuxView(skinId: string, viewId: string): void {
  writeOpenAuxViewsForSkin(
    skinId,
    readOpenAuxViewsForSkin(skinId).filter((id) => id !== viewId),
  );
}
