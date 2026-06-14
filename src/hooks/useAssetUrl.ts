import { useEffect, useState } from "react";
import { toAssetUrl } from "../lib/assetUrl";

const urlCache = new Map<string, string>();
const pendingResolves = new Map<string, Promise<string>>();

function resolveAssetUrl(path: string): Promise<string> {
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

/** Resolve a local file path to an asset URL for display in the WebView. */
export function useAssetUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    path ? (urlCache.get(path) ?? null) : null,
  );

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }

    const cached = urlCache.get(path);
    if (cached) {
      setUrl(cached);
      return;
    }

    let cancelled = false;
    void resolveAssetUrl(path).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return url;
}
