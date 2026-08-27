import { useEffect, useState } from "react";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import {
  getCachedRowArtAssetUrl,
  GRID_ART_THUMB_SIZE,
  resolveRowArtThumbPath,
  ROW_ART_THUMB_SIZE,
  rowArtAssetUrl,
} from "../../lib/rowArtThumb";

export type EntityArtVariant = "default" | "row" | "grid";

function thumbSizeForVariant(variant: EntityArtVariant): number | null {
  if (variant === "row") return ROW_ART_THUMB_SIZE;
  if (variant === "grid") return GRID_ART_THUMB_SIZE;
  return null;
}

function useThumbArtUrl(
  path: string | null | undefined,
  size: number | null,
): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    path && size != null ? getCachedRowArtAssetUrl(path, size) : null,
  );

  useEffect(() => {
    if (!path || size == null) {
      setUrl(null);
      return;
    }

    const cachedUrl = getCachedRowArtAssetUrl(path, size);
    if (cachedUrl) {
      setUrl(cachedUrl);
      return;
    }

    let cancelled = false;
    void resolveRowArtThumbPath(path, size).then((thumbPath) => {
      if (cancelled) return;
      setUrl(thumbPath ? rowArtAssetUrl(thumbPath) : null);
    });

    return () => {
      cancelled = true;
    };
  }, [path, size]);

  return url;
}

export function useEntityArtSrc(
  artPath: string | null,
  variant: EntityArtVariant,
): string | null {
  const thumbSize = thumbSizeForVariant(variant);
  const thumbSrc = useThumbArtUrl(
    thumbSize != null ? artPath : null,
    thumbSize,
  );
  const defaultSrc = useAssetUrl(thumbSize != null ? null : artPath);
  return thumbSize != null ? thumbSrc : defaultSrc;
}
