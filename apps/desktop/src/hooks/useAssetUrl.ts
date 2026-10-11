import { useEffect, useState } from "react";
import { useArtDisplayEpoch } from "../lib/artDisplayCache";
import { getCachedAssetUrl, resolveAssetUrl } from "../lib/assetUrlCache";

/** Resolve a local file path to an asset URL for display in the WebView. */
export function useAssetUrl(path: string | null | undefined): string | null {
  const epoch = useArtDisplayEpoch();
  const [url, setUrl] = useState<string | null>(() =>
    path ? getCachedAssetUrl(path) : null,
  );

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }

    const cached = getCachedAssetUrl(path);
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
  }, [path, epoch]);

  return url;
}
