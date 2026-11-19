import { useLayoutEffect, type RefObject } from "react";

/**
 * Flags a scrollable element so its CSS can fade the clipped edges: `data-scrollable` when the
 * content overflows, `data-scroll-top` / `data-scroll-bottom` when more is hidden that way.
 */
function syncScrollFade(el: HTMLElement) {
  const max = el.scrollHeight - el.clientHeight;
  const scrollable = max > 1;
  el.toggleAttribute("data-scrollable", scrollable);
  el.toggleAttribute("data-scroll-top", scrollable && el.scrollTop > 1);
  el.toggleAttribute(
    "data-scroll-bottom",
    scrollable && el.scrollTop < max - 1,
  );
}

export function useScrollFade(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
) {
  // Content can change without the menu resizing, so re-check after every render.
  useLayoutEffect(() => {
    if (active && ref.current) syncScrollFade(ref.current);
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const onScroll = () => syncScrollFade(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref, active]);
}
