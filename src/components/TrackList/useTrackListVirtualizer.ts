import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

function measureScrollMargin(
  bodyEl: HTMLElement | null,
  scrollEl: HTMLElement | null,
): number {
  if (!bodyEl || !scrollEl) return 0;
  const bodyRect = bodyEl.getBoundingClientRect();
  const scrollRect = scrollEl.getBoundingClientRect();
  return bodyRect.top - scrollRect.top + scrollEl.scrollTop;
}

interface UseTrackListVirtualizerOptions {
  enabled: boolean;
  count: number;
  listRef: RefObject<HTMLElement | null>;
  bodyRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
  estimateSize: number;
  getItemKey?: (index: number) => string | number;
  overscan?: number;
  initialRect?: { width: number; height: number };
}

export function useTrackListVirtualizer({
  enabled,
  count,
  listRef,
  bodyRef,
  scrollRef,
  estimateSize,
  getItemKey,
  overscan = 8,
  initialRect,
}: UseTrackListVirtualizerOptions) {
  const [scrollMargin, setScrollMargin] = useState(0);

  const getScrollElement = useCallback(() => scrollRef.current, [scrollRef]);

  useLayoutEffect(() => {
    if (!enabled) return;

    const update = () => {
      setScrollMargin(measureScrollMargin(bodyRef.current, getScrollElement()));
    };

    update();

    const observer = new ResizeObserver(update);
    if (listRef.current) observer.observe(listRef.current);
    if (bodyRef.current) observer.observe(bodyRef.current);
    const scrollEl = scrollRef.current;
    if (scrollEl) observer.observe(scrollEl);
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [enabled, count, getScrollElement, listRef, bodyRef, scrollRef]);

  const virtualizer = useVirtualizer({
    count: enabled ? count : 0,
    getScrollElement,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin,
    getItemKey: getItemKey ? (index) => getItemKey(index) : undefined,
    initialRect,
  });

  return virtualizer;
}
