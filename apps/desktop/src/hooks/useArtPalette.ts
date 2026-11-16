import { useEffect, useState } from "react";
import { toAssetUrl } from "@/lib/art/assetUrl";
import { extractPaletteFromImageUrl } from "@/lib/ui/palette";

/** Palettes already read, so grids of covers extract each image once. */
const paletteCache = new Map<string, string[]>();
const pending = new Map<string, Promise<string[]>>();

function paletteFor(artPath: string, accent?: string): Promise<string[]> {
  const cached = paletteCache.get(artPath);
  if (cached) return Promise.resolve(cached);
  let request = pending.get(artPath);
  if (!request) {
    request = toAssetUrl(artPath)
      .then((url) => extractPaletteFromImageUrl(url, accent))
      .then((colors) => {
        paletteCache.set(artPath, colors);
        return colors;
      })
      .finally(() => pending.delete(artPath));
    pending.set(artPath, request);
  }
  return request;
}

/**
 * Swatches of an album cover, or null until they are read (or with no art).
 * `accent` colors the palette when the image has no usable swatches.
 */
export function useArtPalette(
  artPath: string | null,
  accent?: string,
): string[] | null {
  const [palette, setPalette] = useState<string[] | null>(
    artPath ? (paletteCache.get(artPath) ?? null) : null,
  );

  useEffect(() => {
    if (!artPath) {
      setPalette(null);
      return;
    }
    let cancelled = false;
    void paletteFor(artPath, accent).then((colors) => {
      if (!cancelled) setPalette(colors);
    });
    return () => {
      cancelled = true;
    };
  }, [artPath, accent]);

  return palette;
}
