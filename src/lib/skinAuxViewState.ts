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
        map[skinId] = viewIds.filter((id): id is string => typeof id === "string");
      }
    }
    return map;
  } catch {
    return {};
  }
}

function writeOpenMap(map: Record<string, string[]>): void {
  localStorage.setItem(OPEN_AUX_KEY, JSON.stringify(map));
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
