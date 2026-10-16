import { readItemReadme } from "../tauri";

type PackReadmeCacheEntry =
  | { status: "loading"; promise: Promise<string | null> }
  | { status: "ready"; value: string | null }
  | { status: "error" };

const cache = new Map<string, PackReadmeCacheEntry>();

/** In-flight or settled README for a pack directory, if any. */
export function peekPackReadme(packDir: string): PackReadmeCacheEntry | undefined {
  return cache.get(packDir);
}

/** Seed/overwrite the cache after a local save (or clear). */
export function setPackReadmeCache(
  packDir: string,
  value: string | null,
): void {
  cache.set(packDir, { status: "ready", value });
}

export function invalidatePackReadmeCache(packDir: string): void {
  cache.delete(packDir);
}

/** Drop every cached README (e.g. after Reload Linked Packs). */
export function invalidateAllPackReadmeCaches(): void {
  cache.clear();
}

/**
 * Start (or reuse) a README fetch for `packDir`. Safe to call before the
 * About panel mounts — later callers share the same promise/result.
 */
export function prefetchPackReadme(packDir: string): Promise<string | null> {
  const existing = cache.get(packDir);
  if (existing?.status === "ready") {
    return Promise.resolve(existing.value);
  }
  if (existing?.status === "loading") {
    return existing.promise;
  }

  const promise = readItemReadme(packDir)
    .then((value) => {
      const current = cache.get(packDir);
      // Ignore stale resolution if the entry was replaced/invalidated.
      if (
        current?.status === "loading" &&
        current.promise === promise
      ) {
        cache.set(packDir, { status: "ready", value });
      }
      return value;
    })
    .catch((err: unknown) => {
      const current = cache.get(packDir);
      if (
        current?.status === "loading" &&
        current.promise === promise
      ) {
        cache.set(packDir, { status: "error" });
      }
      throw err;
    });

  cache.set(packDir, { status: "loading", promise });
  return promise;
}
