import { useEffect, useState } from "react";
import type { ImageCrop } from "../lib/imageCrop";
import { measureArtSizes } from "../lib/tauri";

export type OutputSizes = {
  /** Known once the first size has been measured. */
  sourceBytes: number | null;
  /** Encoded size per requested edge, in the order of `maxEdges`; `undefined` until measured. */
  outputBytes: (number | undefined)[];
};

const DEBOUNCE_MS = 300;

/**
 * Encoded sizes of a crop at each output cap, measured by the backend with the
 * same code that writes the art. Re-measures shortly after the crop settles.
 * The size at `firstIndex` is measured on its own first, then the rest follow
 * in parallel, and results are published as each one arrives. `null` until the
 * first one is in.
 */
export function useOutputSizes(
  filePath: string | null,
  crop: ImageCrop | null,
  maxEdges: (number | null)[],
  enabled: boolean,
  firstIndex = 0,
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

    const run = async () => {
      let sourceBytes: number | null = null;
      const outputBytes: (number | undefined)[] = maxEdges.map(() => undefined);
      const measureOne = async (index: number) => {
        try {
          const measured = await measureArtSizes(filePath, crop, [
            maxEdges[index],
          ]);
          if (cancelled) return;
          sourceBytes = measured.sourceBytes;
          outputBytes[index] = measured.outputBytes[0];
          setResult({
            key,
            sizes: { sourceBytes, outputBytes: [...outputBytes] },
          });
        } catch {
          // A failed size just stays unmeasured.
        }
      };

      const first = Math.min(Math.max(firstIndex, 0), maxEdges.length - 1);
      await measureOne(first);
      await Promise.all(
        maxEdges
          .map((_, index) => index)
          .filter((index) => index !== first)
          .map(measureOne),
      );
    };

    const timer = window.setTimeout(() => void run(), DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `key` captures every input; the rest are read fresh inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A stale result is hidden rather than shown against a different crop.
  return key && result?.key === key ? result.sizes : null;
}
