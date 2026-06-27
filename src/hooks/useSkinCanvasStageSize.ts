import { useEffect, useState, type RefObject } from "react";

export interface CanvasStageSize {
  width: number;
  height: number;
}

export function useSkinCanvasStageSize(
  stageRef: RefObject<HTMLElement | null>,
  fallback: CanvasStageSize,
): CanvasStageSize {
  const [size, setSize] = useState<CanvasStageSize>(fallback);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width > 0 && height > 0) {
        setSize({ width, height });
      }
    };

    measure();

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [stageRef, fallback.width, fallback.height]);

  return size;
}
