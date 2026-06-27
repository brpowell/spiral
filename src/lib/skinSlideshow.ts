import type {
  LayoutNode,
  SlideshowDeck,
  SlideshowNode,
  SlideshowPresentation,
} from "../types/skin";

export interface SlideshowRuntimeState {
  deck: string | null;
  page: number;
}

export type SlideshowStateMap = Record<string, SlideshowRuntimeState>;

export interface SlideshowDefinition {
  id: string;
  presentation: SlideshowPresentation;
}

const SLIDESHOW_NAV_BINDS = new Set([
  "canPrev",
  "canNext",
  "showPageNav",
  "atFirst",
  "atLast",
]);

export function collectSlideshowNodes(node: LayoutNode): SlideshowDefinition[] {
  const found: SlideshowDefinition[] = [];

  const walk = (current: LayoutNode): void => {
    if (current.type === "slideshow" && current.id) {
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

export function initSlideshowState(
  definitions: SlideshowDefinition[],
): SlideshowStateMap {
  const state: SlideshowStateMap = {};
  for (const def of definitions) {
    state[def.id] = { deck: null, page: 1 };
  }
  return state;
}

export function resolveSlideshowAssetPath(
  assetPattern: string,
  deckIndex: number,
  page: number,
): string {
  return assetPattern
    .replace(/\{deckIndex\}/g, String(deckIndex))
    .replace(/\{page\}/g, String(page));
}

export function deckConfig(
  presentation: SlideshowPresentation,
  deckName: string,
): SlideshowDeck | undefined {
  return presentation.decks[deckName];
}

export function evaluateSlideshowBind(
  path: string,
  definitions: Record<string, SlideshowPresentation>,
  state: SlideshowStateMap,
): boolean | null {
  if (!path.startsWith("slideshow.")) return null;

  const rest = path.slice("slideshow.".length);
  const idEnd = rest.indexOf(".");
  if (idEnd < 0) return null;

  const id = rest.slice(0, idEnd);
  const suffix = rest.slice(idEnd + 1);
  const presentation = definitions[id];
  const runtime = state[id];

  const isSlideshowPath =
    suffix.startsWith("deck.") ||
    suffix.startsWith("page.") ||
    SLIDESHOW_NAV_BINDS.has(suffix);
  if (!isSlideshowPath) return null;

  if (!presentation || !runtime) return false;

  if (suffix.startsWith("deck.")) {
    const deckRest = suffix.slice("deck.".length);
    const pageMarker = ".page.";
    const pageMarkerIndex = deckRest.indexOf(pageMarker);
    if (pageMarkerIndex >= 0) {
      const deckName = deckRest.slice(0, pageMarkerIndex);
      const page = Number.parseInt(
        deckRest.slice(pageMarkerIndex + pageMarker.length),
        10,
      );
      return runtime.deck === deckName && runtime.page === page;
    }
    return runtime.deck === deckRest;
  }

  if (suffix.startsWith("page.")) {
    const page = Number.parseInt(suffix.slice("page.".length), 10);
    return runtime.page === page;
  }

  const activeDeck = runtime.deck ? presentation.decks[runtime.deck] : null;
  const maxPage = activeDeck?.pages ?? 1;

  switch (suffix) {
    case "canPrev":
      return runtime.page > 1;
    case "canNext":
      return runtime.page < maxPage;
    case "atFirst":
      return runtime.page <= 1;
    case "atLast":
      return runtime.page >= maxPage;
    case "showPageNav":
      return activeDeck?.showPageNav !== false;
    default:
      return false;
  }
}

export function clampSlideshowPage(page: number, maxPage: number): number {
  if (maxPage < 1) return 1;
  return Math.min(Math.max(page, 1), maxPage);
}

export function resolveSlideshowAssetForState(
  node: SlideshowNode,
  state: SlideshowRuntimeState | undefined,
): string | null {
  if (!state?.deck) return null;

  const deck = deckConfig(node.presentation, state.deck);
  if (!deck) return null;

  const page = clampSlideshowPage(state.page, deck.pages);
  return resolveSlideshowAssetPath(
    node.presentation.assetPattern,
    deck.deckIndex,
    page,
  );
}
