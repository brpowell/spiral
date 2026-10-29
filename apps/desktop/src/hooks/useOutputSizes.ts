import { useEffect, useState } from "react";
import type { ImageCrop } from "../lib/imageCrop";
import { measureArtSizes } from "../lib/tauri";

export type OutputSizes = {
  sourceBytes: number;
  /** Encoded size per requested edge, in the same order as `maxEdges`. */
  outputBytes: number[];
};

const DEBOUNCE_MS = 300;

/**
 * Encoded sizes of a crop at each output cap, measured by the backend with the
 * same code that writes the art. Re-measures shortly after the crop settles;
 * `null` while a measurement is pending or if it failed.
 */
export function useOutputSizes(
  filePath: string | null,
  crop: ImageCrop | null,
  maxEdges: (number | null)[],
  enabled: boolean,
): OutputSizes | null {
  const [result, setResult] = useState<{
    key: string;
    sizes: OutputSizes;
  } | null>(null);

  const key =
    enabled && filePath && crop
      ? [
          filePath,
          crop.x.toFixed(4),
          crop.y.toFixed(4),
          crop.width.toFixed(4),
          crop.height.toFixed(4),
          maxEdges.join(","),
        ].join("|")
      : null;

  useEffect(() => {
    if (!key || !filePath || !crop) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      measureArtSizes(filePath, crop, maxEdges).then(
        (sizes) => {
          if (!cancelled) setResult({ key, sizes });
        },
        () => {},
      );
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `key` captures every input; crop and maxEdges are read fresh inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A stale result is hidden rather than shown against a different crop.
  return key && result?.key === key ? result.sizes : null;
}
