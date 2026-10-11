import { useLayoutEffect, type RefObject } from "react";
import { syncTextareaAutoSize } from "../Textarea/Textarea";
import { capHeight, anchorOffsetTop, readCssPx } from "./fitModalHeight";

const BURST_LIMIT = 4;

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

function collectObserved(panel: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  const add = (el: Element | null) => {
    if (el instanceof HTMLElement) found.push(el);
  };

  add(panel.querySelector(".modal-header"));
  add(panel.querySelector(".modal-footer"));
  add(panel.querySelector(".tabs__list"));

  const active = panel.querySelector(".tabs__panel:not([hidden])");
  const body = panel.querySelector(".modal-body");
  const contentRoot = active ?? body;
  if (contentRoot instanceof HTMLElement) {
    const walker = document.createTreeWalker(
      contentRoot,
      NodeFilter.SHOW_ELEMENT,
    );
    let node = walker.nextNode();
    while (node) {
      if (node instanceof HTMLElement) found.push(node);
      node = walker.nextNode();
    }
  }

  if (body instanceof HTMLElement && active) {
    for (const child of body.children) {
      if (!(child instanceof HTMLElement) || child.contains(active)) continue;
      add(child);
      const walker = document.createTreeWalker(child, NodeFilter.SHOW_ELEMENT);
      let node = walker.nextNode();
      while (node) {
        if (node instanceof HTMLElement) found.push(node);
        node = walker.nextNode();
      }
    }
  }

  return found;
}

const MUTATION_OPTIONS: MutationObserverInit = {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["hidden"],
};

/**
 * Autosize textareas keep their row height while a tab is hidden, because
 * scrollHeight is meaningless there. Size any that are currently laid out
 * before reading the panel, or the first measure targets that short box and
 * the real content arrives only after the height transition.
 */
export function flushAutosizeTextareas(root: ParentNode): void {
  for (const node of root.querySelectorAll("textarea.textarea--autosize")) {
    if (!(node instanceof HTMLTextAreaElement)) continue;
    if (node.getClientRects().length === 0) continue;
    const rowsAttr = node.getAttribute("rows");
    const rows = rowsAttr == null ? undefined : Number(rowsAttr);
    syncTextareaAutoSize(
      node,
      rows != null && Number.isFinite(rows) ? rows : undefined,
    );
  }
}

/** Content height of a tab panel, ignoring space the scrollport adds when stretched. */
function contentBoxHeight(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const gap = Number.parseFloat(style.rowGap) || 0;
  let height = 0;
  let count = 0;
  for (const child of el.children) {
    if (!(child instanceof HTMLElement)) continue;
    height += child.offsetHeight;
    count += 1;
  }
  if (count > 1 && gap > 0) height += gap * (count - 1);
  height +=
    (Number.parseFloat(style.paddingTop) || 0) +
    (Number.parseFloat(style.paddingBottom) || 0) +
    (Number.parseFloat(style.borderTopWidth) || 0) +
    (Number.parseFloat(style.borderBottomWidth) || 0);
  return height;
}

/**
 * Changes when tab content changes. Scrolling the capped panel does not.
 * Reads layout, but does not write it.
 */
function contentSignature(panel: HTMLElement): string {
  const parts: number[] = [window.innerWidth, window.innerHeight];
  const header = panel.querySelector(".modal-header");
  const footer = panel.querySelector(".modal-footer");
  const tabList = panel.querySelector(".tabs__list");
  if (header instanceof HTMLElement) parts.push(header.offsetHeight);
  if (footer instanceof HTMLElement) parts.push(footer.offsetHeight);
  if (tabList instanceof HTMLElement) parts.push(tabList.offsetHeight);

  const active = panel.querySelector(".tabs__panel:not([hidden])");
  if (active instanceof HTMLElement)
    parts.push(Math.round(contentBoxHeight(active)));

  for (const tab of panel.querySelectorAll(".tabs__panel")) {
    parts.push(tab.querySelectorAll("*").length);
  }
  return parts.join(":");
}

function withHiddenTabShown(tab: HTMLElement, read: () => number): number {
  const snapshot = {
    position: tab.style.position,
    visibility: tab.style.visibility,
    height: tab.style.height,
    flex: tab.style.flex,
    minHeight: tab.style.minHeight,
    overflow: tab.style.overflow,
    width: tab.style.width,
    left: tab.style.left,
    right: tab.style.right,
    pointerEvents: tab.style.pointerEvents,
  };
  tab.hidden = false;
  tab.style.position = "absolute";
  tab.style.visibility = "hidden";
  tab.style.pointerEvents = "none";
  tab.style.height = "auto";
  tab.style.flex = "none";
  tab.style.minHeight = "0";
  tab.style.overflow = "visible";
  tab.style.left = "0";
  tab.style.right = "0";
  tab.style.width = "100%";
  try {
    flushAutosizeTextareas(tab);
    return read();
  } finally {
    tab.hidden = true;
    tab.style.position = snapshot.position;
    tab.style.visibility = snapshot.visibility;
    tab.style.height = snapshot.height;
    tab.style.flex = snapshot.flex;
    tab.style.minHeight = snapshot.minHeight;
    tab.style.overflow = snapshot.overflow;
    tab.style.width = snapshot.width;
    tab.style.left = snapshot.left;
    tab.style.right = snapshot.right;
    tab.style.pointerEvents = snapshot.pointerEvents;
  }
}

/** Tallest tab's modal height. The visible tab stays put so its scroll position does. */
function tallestTabbedHeight(panel: HTMLElement, natural: number): number {
  const active = panel.querySelector(".tabs__panel:not([hidden])");
  const tabs = [...panel.querySelectorAll<HTMLElement>(".tabs__panel")];
  if (!(active instanceof HTMLElement) || tabs.length < 2) return natural;

  const activeContent = contentBoxHeight(active);
  let maxContent = activeContent;
  for (const tab of tabs) {
    if (tab === active) continue;
    maxContent = Math.max(
      maxContent,
      withHiddenTabShown(tab, () => contentBoxHeight(tab)),
    );
  }
  return natural + Math.max(0, maxContent - activeContent);
}

/**
 * Size the panel to the active tab (up to max-height) and transition later
 * height changes. The top edge stays where the tallest tab would be centered.
 */
export function useFitModalHeight(
  enabled: boolean,
  panelRef: RefObject<HTMLElement | null>,
  backdropRef: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    if (!enabled) return;
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel || !backdrop) return;

    let disposed = false;
    let measuring = false;
    // A height transition stretches the tab body, which fires resize
    // observations. Defer those until the transition ends. DOM mutations
    // (tab changes) retarget immediately.
    let settling = false;
    let pending = false;
    let settleTimer = 0;
    let burst = 0;
    let burstReset = 0;
    let hasApplied = false;
    let lastSignature: string | null = null;
    // Snap while the opening anchor is still settling. A follow-up pass can
    // miss the hidden tab and would otherwise slide the panel into place.
    let opening = true;
    let openFrame = 0;
    let maxAnchorHeight = 0;
    const observed = new Set<Element>();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            measure(false);
          });

    const syncObserved = () => {
      if (!resizeObserver) return;
      const next = new Set(collectObserved(panel));
      for (const el of observed) {
        if (!next.has(el)) resizeObserver.unobserve(el);
      }
      for (const el of next) {
        if (!observed.has(el)) resizeObserver.observe(el);
      }
      observed.clear();
      for (const el of next) observed.add(el);
    };

    const restoreMeasuringStyles = (heightPx: number | null) => {
      panel.style.maxHeight = "";
      panel.style.height = heightPx == null ? "" : `${heightPx}px`;
      panel.style.transition = "";
    };

    const cancelSettling = () => {
      settling = false;
      pending = false;
      window.clearTimeout(settleTimer);
      panel.removeEventListener("transitionend", onTransitionEnd);
    };

    const finishSettling = () => {
      if (!settling) return;
      const shouldMeasure = pending;
      cancelSettling();
      if (shouldMeasure) measure(false);
    };

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== panel) return;
      if (
        event.propertyName !== "height" &&
        event.propertyName !== "margin-top"
      ) {
        return;
      }
      finishSettling();
    };

    const measure = (force: boolean) => {
      if (disposed || measuring) return;
      if (settling && !force) {
        pending = true;
        return;
      }
      if (settling && force) cancelSettling();
      if (burst > BURST_LIMIT) return;

      measuring = true;
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      const scroller = panel.querySelector<HTMLElement>(
        ".tabs__panel:not([hidden])",
      );
      const scrollTop = scroller?.scrollTop ?? 0;
      try {
        flushAutosizeTextareas(panel);
        const signature = contentSignature(panel);
        if (hasApplied && signature === lastSignature && panel.style.height) {
          return;
        }
        burst += 1;
        if (burstReset) cancelAnimationFrame(burstReset);
        burstReset = requestAnimationFrame(() => {
          burst = 0;
        });

        const cssMax = readCssPx(getComputedStyle(panel).maxHeight);
        const from = panel.offsetHeight;

        panel.style.transition = "none";
        panel.style.maxHeight = "none";
        panel.style.height = "auto";
        const natural = panel.offsetHeight;
        const tallest = tallestTabbedHeight(panel, natural);
        panel.style.maxHeight = "";

        const hasBody = panel.querySelector(".modal-body") != null;
        if (!hasBody || natural <= 0) {
          restoreMeasuringStyles(from > 0 ? Math.round(from) : null);
          return;
        }

        const next = Math.round(capHeight(natural, cssMax));
        const anchorHeight = Math.round(capHeight(tallest, cssMax));
        const fromRounded = Math.round(from);
        const padTop = readCssPx(getComputedStyle(backdrop).paddingTop) ?? 0;
        const padBottom =
          readCssPx(getComputedStyle(backdrop).paddingBottom) ?? 0;
        const pinned = Math.round(
          anchorOffsetTop(
            anchorHeight,
            next,
            backdrop.clientHeight,
            padTop,
            padBottom,
          ),
        );
        const currentMargin = Number.parseFloat(panel.style.marginTop);

        panel.style.height = `${fromRounded}px`;

        // A font-load pass can miss the hidden lyrics height and report a
        // shorter anchor. Keep the taller one so the open doesn't slide.
        if (opening && maxAnchorHeight > anchorHeight) {
          panel.style.transition = "";
          lastSignature = signature;
          return;
        }
        if (anchorHeight > maxAnchorHeight) maxAnchorHeight = anchorHeight;

        if (
          hasApplied &&
          fromRounded === next &&
          Number.isFinite(currentMargin) &&
          Math.round(currentMargin) === pinned
        ) {
          panel.style.transition = "";
          lastSignature = signature;
          return;
        }

        void panel.offsetHeight;

        const marginChanged =
          !Number.isFinite(currentMargin) ||
          Math.round(currentMargin) !== pinned;
        const animate =
          hasApplied &&
          !opening &&
          !prefersReducedMotion() &&
          (fromRounded !== next || marginChanged);
        if (animate) panel.style.transition = "";

        panel.style.height = `${next}px`;
        panel.style.alignSelf = "flex-start";
        panel.style.marginTop = `${pinned}px`;

        if (animate) {
          settling = true;
          panel.addEventListener("transitionend", onTransitionEnd);
          window.clearTimeout(settleTimer);
          settleTimer = window.setTimeout(finishSettling, 400);
        } else {
          void panel.offsetHeight;
          panel.style.transition = "";
        }

        hasApplied = true;
        lastSignature = signature;
      } finally {
        if (scroller) scroller.scrollTop = scrollTop;
        measuring = false;
        if (!disposed) {
          observed.clear();
          mutationObserver.observe(panel, MUTATION_OPTIONS);
          syncObserved();
        }
      }
    };

    const mutationObserver = new MutationObserver(() => {
      syncObserved();
      measure(true);
    });
    mutationObserver.observe(panel, MUTATION_OPTIONS);

    const onResize = () => measure(true);
    window.addEventListener("resize", onResize);

    const fontsReady = document.fonts?.ready;
    const openTimer = window.setTimeout(() => {
      opening = false;
    }, 400);
    void fontsReady?.then(() => {
      if (disposed) return;
      measure(false);
      openFrame = requestAnimationFrame(() => {
        opening = false;
      });
    });
    if (fontsReady == null) {
      openFrame = requestAnimationFrame(() => {
        openFrame = requestAnimationFrame(() => {
          opening = false;
        });
      });
    }

    syncObserved();
    measure(true);

    return () => {
      disposed = true;
      window.clearTimeout(settleTimer);
      panel.removeEventListener("transitionend", onTransitionEnd);
      if (openFrame) cancelAnimationFrame(openFrame);
      window.clearTimeout(openTimer);
      if (burstReset) cancelAnimationFrame(burstReset);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [enabled, panelRef, backdropRef]);
}
