import { useLayoutEffect, type RefObject } from "react";

export function useSyncTrackListHeaderScroll(
  horizontalScrollRef: RefObject<HTMLElement | null>,
  headerSyncRef: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const scroll = horizontalScrollRef.current;
    const headerSync = headerSyncRef.current;
    if (!scroll || !headerSync) return;

    let rafId = 0;

    const sync = () => {
      if (rafId !== 0) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        headerSync.style.transform = `translate3d(-${scroll.scrollLeft}px, 0, 0)`;
      });
    };

    sync();

    scroll.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(scroll);
    const inner = scroll.querySelector(".track-list__inner");
    if (inner instanceof HTMLElement) observer.observe(inner);

    return () => {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      scroll.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, [horizontalScrollRef, headerSyncRef]);
}
