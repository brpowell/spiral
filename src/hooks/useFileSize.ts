import { useEffect, useState } from "react";
import { getFileSize } from "../lib/tauri";

/** Load a file's byte size from disk; null while loading or on failure. */
export function useFileSize(path: string | null | undefined): number | null {
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);

  useEffect(() => {
    setSizeBytes(null);
    if (!path) return;

    let cancelled = false;

    void getFileSize(path)
      .then((size) => {
        if (!cancelled) setSizeBytes(size);
      })
      .catch(() => {
        if (!cancelled) setSizeBytes(null);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return sizeBytes;
}
