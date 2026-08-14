import { fetchRegistryPackVersionSafe } from "../packRegistry";

export type CatalogVersionDocs = {
  readme: string | null;
  changelog: string | null;
};

type CacheEntry =
  | { status: "loading"; promise: Promise<CatalogVersionDocs | null> }
  | { status: "ready"; value: CatalogVersionDocs | null };

const cache = new Map<string, CacheEntry>();

function docsKey(args: {
  registryUrl: string;
  authorId: string;
  packId: string;
  version: string;
}): string {
  return `${args.registryUrl}\0${args.authorId}\0${args.packId}\0${args.version}`;
}

/**
 * Shared fetch for catalog About/Changelog (and tab presence).
 * Coalesces concurrent callers for the same version detail.
 */
export function prefetchCatalogVersionDocs(args: {
  registryUrl: string;
  authorId: string;
  packId: string;
  version: string;
}): Promise<CatalogVersionDocs | null> {
  const key = docsKey(args);
  const existing = cache.get(key);
  if (existing?.status === "ready") {
    return Promise.resolve(existing.value);
  }
  if (existing?.status === "loading") {
    return existing.promise;
  }

  const promise = fetchRegistryPackVersionSafe(args)
    .then((result) => {
      if (!result.ok) {
        cache.set(key, { status: "ready", value: null });
        return null;
      }
      const readme = result.detail.readme?.trim() || null;
      const changelog = result.detail.changelog?.trim() || null;
      const value: CatalogVersionDocs = {
        readme: readme && readme.length > 0 ? readme : null,
        changelog: changelog && changelog.length > 0 ? changelog : null,
      };
      const current = cache.get(key);
      if (
        current?.status === "loading" &&
        current.promise === promise
      ) {
        cache.set(key, { status: "ready", value });
      }
      return value;
    })
    .catch(() => {
      const current = cache.get(key);
      if (
        current?.status === "loading" &&
        current.promise === promise
      ) {
        cache.set(key, { status: "ready", value: null });
      }
      return null;
    });

  cache.set(key, { status: "loading", promise });
  return promise;
}
