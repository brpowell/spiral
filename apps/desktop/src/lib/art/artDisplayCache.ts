import { useSyncExternalStore } from "react";
import { invalidateAssetUrlCache } from "./assetUrlCache";
import { invalidateRowArtThumbCache } from "./rowArtThumb";

let artDisplayEpoch = 0;
const listeners = new Set<() => void>();

function subscribeArtDisplayEpoch(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getArtDisplayEpoch(): number {
  return artDisplayEpoch;
}

/** Subscribe to art-display cache invalidations (same-path content updates). */
export function useArtDisplayEpoch(): number {
  return useSyncExternalStore(
    subscribeArtDisplayEpoch,
    getArtDisplayEpoch,
    getArtDisplayEpoch,
  );
}

/**
 * Drop in-memory asset/thumb URL caches for overwritten art files and bump an
 * epoch so `useAssetUrl` / EntityArt re-resolve with a fresh mtime cache-bust.
 */
export function refreshArtDisplay(
  paths: Iterable<string | null | undefined>,
): void {
  const unique = [
    ...new Set(
      [...paths].filter((path): path is string => !!path && path.trim() !== ""),
    ),
  ];
  if (unique.length === 0) return;

  invalidateAssetUrlCache(unique);
  invalidateRowArtThumbCache(unique);
  artDisplayEpoch += 1;
  for (const listener of listeners) {
    listener();
  }
}
