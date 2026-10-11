import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

interface UseTrackListHeaderRovingOptions {
  scrollContainerRef?: RefObject<HTMLElement | null>;
  getScrollPaddingEnd?: () => number;
}

function scrollHeaderCellIntoView(
  element: HTMLElement,
  scrollContainer: HTMLElement,
  paddingEnd: number,
) {
  const containerRect = scrollContainer.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  const visibleLeft = containerRect.left;
  const visibleRight = containerRect.right - paddingEnd;

  if (elementRect.left < visibleLeft) {
    scrollContainer.scrollLeft += elementRect.left - visibleLeft;
  } else if (elementRect.right > visibleRight) {
    scrollContainer.scrollLeft += elementRect.right - visibleRight;
  }
}

export function useTrackListHeaderRoving(
  count: number,
  options: UseTrackListHeaderRovingOptions = {},
) {
  const { scrollContainerRef, getScrollPaddingEnd } = options;
  const [focusedIndex, setFocusedIndex] = useState(0);
  const headerRefs = useRef<(HTMLElement | null)[]>([]);

  const scrollFocusedCellIntoView = useCallback(
    (index: number) => {
      const element = headerRefs.current[index];
      const scrollContainer = scrollContainerRef?.current;
      if (!element || !scrollContainer) return;

      requestAnimationFrame(() => {
        scrollHeaderCellIntoView(
          element,
          scrollContainer,
          getScrollPaddingEnd?.() ?? 0,
        );
      });
    },
    [getScrollPaddingEnd, scrollContainerRef],
  );

  useEffect(() => {
    if (count === 0) return;
    if (focusedIndex >= count) {
      setFocusedIndex(count - 1);
    }
  }, [count, focusedIndex]);

  const focusAt = useCallback(
    (index: number) => {
      if (count === 0) return;
      const next = Math.max(0, Math.min(index, count - 1));
      setFocusedIndex(next);
      headerRefs.current[next]?.focus();
    },
    [count],
  );

  const getTabIndex = useCallback(
    (index: number) => (count > 0 && index === focusedIndex ? 0 : -1),
    [count, focusedIndex],
  );

  const setHeaderRef = useCallback(
    (index: number) => (element: HTMLElement | null) => {
      headerRefs.current[index] = element;
    },
    [],
  );

  const onHeaderFocus = useCallback(
    (index: number) => {
      setFocusedIndex(index);
      scrollFocusedCellIntoView(index);
    },
    [scrollFocusedCellIntoView],
  );

  const onHeaderKeyDown = useCallback(
    (
      e: React.KeyboardEvent,
      index: number,
      onActivate?: () => void,
    ) => {
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          focusAt(index + 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          focusAt(index - 1);
          break;
        case "Home":
          e.preventDefault();
          focusAt(0);
          break;
        case "End":
          e.preventDefault();
          focusAt(count - 1);
          break;
        case "Enter":
        case " ":
          if (onActivate) {
            e.preventDefault();
            onActivate();
          }
          break;
      }
    },
    [count, focusAt],
  );

  return {
    getTabIndex,
    setHeaderRef,
    onHeaderFocus,
    onHeaderKeyDown,
  };
}
