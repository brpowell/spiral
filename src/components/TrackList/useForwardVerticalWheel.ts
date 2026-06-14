import { useEffect, type RefObject } from "react";
import { findVerticalScrollParent } from "./scrollParent";

/**
 * The track list scrolls horizontally inside a container that cannot scroll
 * vertically. Browsers still route wheel events to that element when the
 * pointer is over it, which blocks the page scroller after horizontal input.
 */
export function useForwardVerticalWheel(
  horizontalScrollRef: RefObject<HTMLElement | null>,
  headerViewportRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const elements = [horizontalScrollRef.current, headerViewportRef.current].filter(
      (el): el is HTMLElement => el != null,
    );
    if (elements.length === 0) return;

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

      const target = e.currentTarget as HTMLElement;
      const verticalScroller = findVerticalScrollParent(target);
      if (!verticalScroller) return;

      verticalScroller.scrollTop += e.deltaY;
      e.preventDefault();
    };

    for (const el of elements) {
      el.addEventListener("wheel", onWheel, { passive: false });
    }

    return () => {
      for (const el of elements) {
        el.removeEventListener("wheel", onWheel);
      }
    };
  }, [horizontalScrollRef, headerViewportRef]);
}
