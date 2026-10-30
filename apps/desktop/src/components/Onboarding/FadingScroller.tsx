import { useEffect, useRef, type ReactNode } from "react";

/** Pixels from an edge within which the content counts as "at" that edge. */
const EDGE_TOLERANCE = 1;

/**
 * A vertical scroller that fades its content out at an edge only while more
 * content lies past that edge. Sets `data-fade-top` / `data-fade-bottom`; the
 * stylesheet turns them into a mask.
 */
export function FadingScroller({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      el.toggleAttribute("data-fade-top", scrollTop > EDGE_TOLERANCE);
      el.toggleAttribute(
        "data-fade-bottom",
        scrollTop + clientHeight < scrollHeight - EDGE_TOLERANCE,
      );
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    // Window resizes change the viewport; content loading changes the children.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    for (const child of Array.from(el.children)) observer?.observe(child);

    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
