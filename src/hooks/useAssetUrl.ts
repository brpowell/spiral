import { useEffect, useState } from "react";
import { toAssetUrl } from "../lib/assetUrl";

/** Resolve a local file path to a cache-busted asset URL for display in the WebView. */
export function useAssetUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }

    let cancelled = false;
    void toAssetUrl(path).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return url;
}
