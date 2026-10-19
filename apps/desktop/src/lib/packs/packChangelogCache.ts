import { readItemChangelog } from "../tauri";

type PackChangelogCacheEntry =
  | { status: "loading"; promise: Promise<string | null> }
  | { status: "ready"; value: string | null }
  | { status: "error" };

const cache = new Map<string, PackChangelogCacheEntry>();

/** In-flight or settled CHANGELOG for a pack directory, if any. */
export function peekPackChangelog(
  packDir: string,
): PackChangelogCacheEntry | undefined {
  return cache.get(packDir);
}

/** Seed/overwrite the cache after a local save (or clear). */
export function setPackChangelogCache(
  packDir: string,
  value: string | null,
): void {
  cache.set(packDir, { status: "ready", value });
}

export function invalidatePackChangelogCache(packDir: string): void {
  cache.delete(packDir);
}

/** Drop every cached CHANGELOG (e.g. after Reload Linked Packs). */
export function invalidateAllPackChangelogCaches(): void {
  cache.clear();
}

/**
 * Start (or reuse) a CHANGELOG fetch for `packDir`. Safe to call before the
 * Changelog panel mounts — later callers share the same promise/result.
 */
export function prefetchPackChangelog(
  packDir: string,
): Promise<string | null> {
  const existing = cache.get(packDir);
  if (existing?.status === "ready") {
    return Promise.resolve(existing.value);
  }
  if (existing?.status === "loading") {
    return existing.promise;
  }

  const promise = readItemChangelog(packDir)
    .then((value) => {
      const current = cache.get(packDir);
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
