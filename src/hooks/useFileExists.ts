import { useEffect, useState } from "react";
import { fileExists } from "../lib/artPath";

/** Whether a path exists on disk; null while resolving. */
export function useFileExists(path: string | null | undefined): boolean | null {
  const [exists, setExists] = useState<boolean | null>(null);

  useEffect(() => {
    setExists(null);
    if (!path) return;

    let cancelled = false;

    void fileExists(path)
      .then((found) => {
        if (!cancelled) setExists(found);
      })
      .catch(() => {
        if (!cancelled) setExists(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return exists;
}
