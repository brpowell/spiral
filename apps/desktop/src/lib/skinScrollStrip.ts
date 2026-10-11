import type {
  LayoutTreeNode,
  ScrollStripNode,
  ScrollStripPresentation,
} from "../types/skin";

export interface ScrollStripRuntimeState {
  slide: number;
}

export type ScrollStripStateMap = Record<string, ScrollStripRuntimeState>;

export interface ScrollStripDefinition {
  id: string;
  presentation: ScrollStripPresentation;
}

const SCROLL_STRIP_NAV_BINDS = new Set([
  "canPrev",
  "canNext",
  "atFirst",
  "atLast",
]);

export function collectScrollStripNodes(
  node: LayoutTreeNode,
): ScrollStripDefinition[] {
  const found: ScrollStripDefinition[] = [];

  const walk = (current: LayoutTreeNode): void => {
    if (current.type === "scrollStrip" && current.id) {
      found.push({ id: current.id, presentation: current.presentation });
    }

    if ("children" in current && Array.isArray(current.children)) {
      for (const child of current.children) {
        walk(child);
      }
    }
  };

  walk(node);
  return found;
}

export function initScrollStripState(
  definitions: ScrollStripDefinition[],
): ScrollStripStateMap {
  const state: ScrollStripStateMap = {};
  for (const def of definitions) {
    state[def.id] = { slide: 1 };
  }
  return state;
}

export function scrollStripSlideCount(
  presentation: ScrollStripPresentation,
): number {
  return presentation.slides.length;
}

export function clampScrollStripSlide(slide: number, maxSlide: number): number {
  if (maxSlide < 1) return 1;
  return Math.min(Math.max(slide, 1), maxSlide);
}

export function evaluateScrollStripBind(
  path: string,
  definitions: Record<string, ScrollStripPresentation>,
  state: ScrollStripStateMap,
): boolean | null {
  if (!path.startsWith("scrollStrip.")) return null;

  const rest = path.slice("scrollStrip.".length);
  const idEnd = rest.indexOf(".");
  if (idEnd < 0) return null;

  const id = rest.slice(0, idEnd);
  const suffix = rest.slice(idEnd + 1);
  const presentation = definitions[id];
  const runtime = state[id];

  const isScrollStripPath =
    suffix.startsWith("slide.") || SCROLL_STRIP_NAV_BINDS.has(suffix);
  if (!isScrollStripPath) return null;

  if (!presentation || !runtime) return false;

  if (suffix.startsWith("slide.")) {
    const slide = Number.parseInt(suffix.slice("slide.".length), 10);
    return runtime.slide === slide;
  }

  const maxSlide = scrollStripSlideCount(presentation);

  switch (suffix) {
    case "canPrev":
      return runtime.slide > 1;
    case "canNext":
      return runtime.slide < maxSlide;
    case "atFirst":
      return runtime.slide <= 1;
    case "atLast":
      return runtime.slide >= maxSlide;
    default:
      return false;
  }
}

export function resolveScrollStripSlideLayout(
  node: ScrollStripNode,
  slide: number,
): Record<string, { y: number }> {
  const index =
    clampScrollStripSlide(slide, node.presentation.slides.length) - 1;
  return node.presentation.slides[index]?.items ?? {};
}

export function resolveScrollStripItemTop(
  stageY: number,
  stripOriginY: number,
): number {
  return stageY - stripOriginY;
}

/** Seed off-slide item positions so first scroll transitions don't start from top: 0. */
export function buildScrollStripInitialTops(
  node: ScrollStripNode,
  stripOriginY: number,
): Record<string, number> {
  const tops: Record<string, number> = {};

  for (const item of node.presentation.items) {
    for (const slide of node.presentation.slides) {
      const placement = slide.items[item.id];
      if (placement) {
        tops[item.id] = resolveScrollStripItemTop(placement.y, stripOriginY);
        break;
      }
    }
  }

  return tops;
}
