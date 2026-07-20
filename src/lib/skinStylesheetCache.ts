import type { LoadedSkinPack } from "../types/skin";
import { scopeSkinStylesheet } from "./scopeSkinStylesheet";
import { skinStylesheetUrl } from "./skinStylesheet";

const scopedCssCache = new Map<string, string>();

function cacheKey(skinId: string, generation: number): string {
  return `${skinId}:${generation}`;
}

/** Fetch + scope a skin stylesheet so the first paint after a switch can inject sync. */
export async function preloadSkinStylesheet(
  pack: LoadedSkinPack,
  generation = 0,
): Promise<void> {
  const href = skinStylesheetUrl(pack);
  if (!href) return;

  const key = cacheKey(pack.summary.id, generation);
  if (scopedCssCache.has(key)) return;

  try {
    const response = await fetch(`${href}?v=${generation}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const css = await response.text();
    scopedCssCache.set(key, scopeSkinStylesheet(css, pack.summary.id));
  } catch (err) {
    console.warn("preloadSkinStylesheet:", err);
  }
}

export function getCachedScopedSkinStylesheet(
  skinId: string,
  generation = 0,
): string | undefined {
  return scopedCssCache.get(cacheKey(skinId, generation));
}
