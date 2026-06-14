import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { findVerticalScrollParent } from "./scrollParent";
import "./TrackListPinnedHScroll.css";

interface BarMetrics {
  left: number;
  width: number;
  scrollWidth: number;
}

function measureBar(
  source: HTMLElement,
): { metrics: BarMetrics; hasOverflow: boolean } | null {
  const scrollView = findVerticalScrollParent(source);
  const mainContent = scrollView?.closest(".main-content");
  if (!(mainContent instanceof HTMLElement)) return null;

  const { scrollWidth, clientWidth } = source;
  const hasOverflow = scrollWidth > clientWidth + 1;
  if (!hasOverflow) {
    return { metrics: { left: 0, width: 0, scrollWidth: 0 }, hasOverflow: false };
  }

  const rect = mainContent.getBoundingClientRect();
  return {
    hasOverflow: true,
    metrics: {
      left: rect.left,
      width: rect.width,
      scrollWidth,
    },
  };
}

interface TrackListPinnedHScrollProps {
  sourceRef: RefObject<HTMLElement | null>;
}

export function TrackListPinnedHScroll({ sourceRef }: TrackListPinnedHScrollProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [barMetrics, setBarMetrics] = useState<BarMetrics | null>(null);

  useLayoutEffect(() => {
    const source = sourceRef.current;
    if (!source) return;

    const update = () => {
      const result = measureBar(source);
      setBarMetrics(result?.hasOverflow ? result.metrics : null);
    };

    const syncToBar = () => {
      const bar = barRef.current;
      if (!bar || bar.scrollLeft === source.scrollLeft) return;
      bar.scrollLeft = source.scrollLeft;
    };

    update();

    const observer = new ResizeObserver(update);
    observer.observe(source);
    const inner = source.querySelector(".track-list__inner");
    if (inner instanceof HTMLElement) observer.observe(inner);

    const scrollView = findVerticalScrollParent(source);
    if (scrollView) observer.observe(scrollView);
    const mainContent = scrollView?.closest(".main-content");
    if (mainContent instanceof HTMLElement) observer.observe(mainContent);

    source.addEventListener("scroll", syncToBar, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      source.removeEventListener("scroll", syncToBar);
      window.removeEventListener("resize", update);
    };
  }, [sourceRef]);

  useLayoutEffect(() => {
    if (!barMetrics) return;

    const source = sourceRef.current;
    const bar = barRef.current;
    if (!source || !bar) return;

    bar.scrollLeft = source.scrollLeft;

    const syncToSource = () => {
      if (source.scrollLeft === bar.scrollLeft) return;
      source.scrollLeft = bar.scrollLeft;
    };

    bar.addEventListener("scroll", syncToSource, { passive: true });
    return () => bar.removeEventListener("scroll", syncToSource);
  }, [barMetrics, sourceRef]);

  if (!barMetrics) return null;

  return createPortal(
    <div
      ref={barRef}
      className="track-list__pinned-h-scroll"
      style={{
        left: barMetrics.left,
        width: barMetrics.width,
      }}
      aria-hidden
    >
      <div
        className="track-list__pinned-h-scroll-inner"
        style={{ width: barMetrics.scrollWidth }}
      />
    </div>,
    document.body,
  );
}
