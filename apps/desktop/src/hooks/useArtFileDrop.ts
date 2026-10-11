import { useEffect, useRef } from "react";
import { ART_FILE_DROP_EVENT, firstImagePath } from "../lib/fileDropRouting";

export function useArtFileDrop(
  enabled: boolean,
  onPath: (path: string) => void | Promise<void>,
) {
  const onPathRef = useRef(onPath);
  onPathRef.current = onPath;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: Event) => {
      const paths = (e as CustomEvent<{ paths: string[] }>).detail.paths;
      const imagePath = firstImagePath(paths);
      if (imagePath) void onPathRef.current(imagePath);
    };

    window.addEventListener(ART_FILE_DROP_EVENT, handler);
    return () => window.removeEventListener(ART_FILE_DROP_EVENT, handler);
  }, [enabled]);
}
