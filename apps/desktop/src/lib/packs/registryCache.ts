/**
 * Small in-memory cache for remote registry reads.
 *
 * - Only cacheable results are stored (by default `ok: true`), so a transient
 *   failure is retried on the next call instead of sticking for the TTL.
 * - Concurrent callers for the same key share one in-flight request.
 * - `force` bypasses a fresh entry (manual refresh / update checks) but still
 *   refreshes the stored value on success.
 */

export type RegistryCache<R extends { ok: boolean }> = {
  /** Fresh cached result, if any (never touches the network). */
  peek: (key: string) => R | undefined;
  /** Cached result, or the loader's; coalesces concurrent loads per key. */
  get: (
    key: string,
    load: () => Promise<R>,
    options?: { force?: boolean },
  ) => Promise<R>;
  clear: () => void;
};

export function createRegistryCache<R extends { ok: boolean }>(options: {
  ttlMs: number;
  maxEntries?: number;
  /** Whether a loader result may be stored. Defaults to `result.ok`. */
  cacheable?: (result: R) => boolean;
  now?: () => number;
}): RegistryCache<R> {
  const { ttlMs, maxEntries = 200 } = options;
  const now = options.now ?? Date.now;
  const cacheable = options.cacheable ?? ((result: R) => result.ok);
  const entries = new Map<string, { result: R; storedAt: number }>();
  const inflight = new Map<string, Promise<R>>();
  /** Bumped by `clear` so loads started before it do not repopulate the cache. */
  let generation = 0;

  const peek = (key: string): R | undefined => {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (now() - entry.storedAt >= ttlMs) {
      entries.delete(key);
      return undefined;
    }
    return entry.result;
  };

  return {
    peek,

    get: (key, load, { force = false } = {}) => {
      if (!force) {
        const hit = peek(key);
        if (hit) return Promise.resolve(hit);
      }
      const pending = inflight.get(key);
      if (pending) return pending;

      const startedIn = generation;
      const promise: Promise<R> = load()
        .then((result) => {
          if (startedIn === generation && cacheable(result)) {
            // Re-insert so the Map's iteration order tracks recency of write.
            entries.delete(key);
            entries.set(key, { result, storedAt: now() });
            if (entries.size > maxEntries) {
              const oldest = entries.keys().next().value;
              if (oldest !== undefined) entries.delete(oldest);
            }
          }
          return result;
        })
        .finally(() => {
          if (inflight.get(key) === promise) inflight.delete(key);
        });
      inflight.set(key, promise);
      return promise;
    },

    clear: () => {
      generation += 1;
      entries.clear();
      inflight.clear();
    },
  };
}
