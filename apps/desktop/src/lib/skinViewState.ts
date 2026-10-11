import type { LoadedSkinPack } from "../types/skin";
import { primaryViewId } from "./skinWindowPresentation";

const STORAGE_KEY = "spiral:skin-view-by-skin";

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function readViewForSkin(skinId: string): string | null {
  const viewId = readMap()[skinId];
  return typeof viewId === "string" ? viewId : null;
}

export function writeViewForSkin(skinId: string, viewId: string): void {
  const map = readMap();
  map[skinId] = viewId;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

/** Per-skin view id; falls back to the primary view (not a global view name). */
export function resolveViewForPack(pack: LoadedSkinPack): string {
  const saved = readViewForSkin(pack.summary.id);

  if (saved && pack.manifest.views[saved]) {
    return saved;
  }
  return (
    primaryViewId(pack.manifest.views) ??
    Object.keys(pack.manifest.views)[0] ??
    "standard"
  );
}
