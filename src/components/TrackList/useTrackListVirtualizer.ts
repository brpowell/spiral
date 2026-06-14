import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";
import { findVerticalScrollParent } from "./scrollParent";

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
  estimateSize: number;
  getItemKey?: (index: number) => string | number;
  overscan?: number;
}

export function useTrackListVirtualizer({
  enabled,
  count,
  listRef,
  bodyRef,
  estimateSize,
  getItemKey,
  overscan = 8,
}: UseTrackListVirtualizerOptions) {
  const [scrollMargin, setScrollMargin] = useState(0);

  const getScrollElement = useCallback(
    () => findVerticalScrollParent(listRef.current),
    [listRef],
  );

  useLayoutEffect(() => {
    if (!enabled) return;

    const update = () => {
      setScrollMargin(
        measureScrollMargin(bodyRef.current, getScrollElement()),
      );
    };

    update();

    const observer = new ResizeObserver(update);
    if (listRef.current) observer.observe(listRef.current);
    if (bodyRef.current) observer.observe(bodyRef.current);
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [enabled, count, getScrollElement, listRef, bodyRef]);

  const virtualizer = useVirtualizer({
    count: enabled ? count : 0,
    getScrollElement,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin,
    getItemKey: getItemKey ? (index) => getItemKey(index) : undefined,
  });

  return virtualizer;
}
