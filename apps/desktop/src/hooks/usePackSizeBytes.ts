import { useEffect, useState } from "react";
import { getDirectorySize } from "../lib/tauri";

/**
 * Pack detail size: probe on-disk directory when local; else catalog uncompressed size.
 * Returns null while probing, on probe failure, or when neither source is available.
 */
export function usePackSizeBytes(args: {
  packDir: string | null | undefined;
  catalogSizeBytes: number | null | undefined;
}): number | null {
  const packDir = args.packDir?.trim() || null;
  const catalogSizeBytes =
    args.catalogSizeBytes != null && args.catalogSizeBytes > 0
      ? args.catalogSizeBytes
      : null;

  const [probedBytes, setProbedBytes] = useState<number | null>(null);

  useEffect(() => {
    setProbedBytes(null);
    if (!packDir) return;

    let cancelled = false;
    void getDirectorySize(packDir)
      .then((size) => {
        if (!cancelled) setProbedBytes(size > 0 ? size : null);
      })
      .catch(() => {
        if (!cancelled) setProbedBytes(null);
      });

    return () => {
      cancelled = true;
    };
  }, [packDir]);

  if (packDir) return probedBytes;
  return catalogSizeBytes;
}
