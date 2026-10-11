import { toAssetUrl } from "./assetUrl";

const urlCache = new Map<string, string>();
const pendingResolves = new Map<string, Promise<string>>();

export function resolveAssetUrl(path: string): Promise<string> {
  const cached = urlCache.get(path);
  if (cached) return Promise.resolve(cached);

  let pending = pendingResolves.get(path);
  if (!pending) {
    pending = toAssetUrl(path).then((resolved) => {
      urlCache.set(path, resolved);
      pendingResolves.delete(path);
      return resolved;
    });
    pendingResolves.set(path, pending);
  }

  return pending;
}

export function getCachedAssetUrl(path: string): string | null {
  return urlCache.get(path) ?? null;
}

/** Drop cached asset URLs so the next resolve picks up a new mtime query. */
export function invalidateAssetUrlCache(paths: Iterable<string>): void {
  for (const path of paths) {
    urlCache.delete(path);
    pendingResolves.delete(path);
  }
}
