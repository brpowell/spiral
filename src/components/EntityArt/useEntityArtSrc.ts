import { useEffect, useState } from "react";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import {
  getCachedRowArtAssetUrl,
  resolveRowArtThumbPath,
  rowArtAssetUrl,
} from "../../lib/rowArtThumb";

type EntityArtVariant = "default" | "row";

function useRowArtUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    path ? getCachedRowArtAssetUrl(path) : null,
  );

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }

    const cachedUrl = getCachedRowArtAssetUrl(path);
    if (cachedUrl) {
      setUrl(cachedUrl);
      return;
    }

    let cancelled = false;
    void resolveRowArtThumbPath(path).then((thumbPath) => {
      if (cancelled) return;
      setUrl(thumbPath ? rowArtAssetUrl(thumbPath) : null);
    });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return url;
}

export function useEntityArtSrc(
  artPath: string | null,
  variant: EntityArtVariant,
): string | null {
  const rowSrc = useRowArtUrl(variant === "row" ? artPath : null);
  const defaultSrc = useAssetUrl(variant === "row" ? null : artPath);
  return variant === "row" ? rowSrc : defaultSrc;
}
