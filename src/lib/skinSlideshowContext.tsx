import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clampSlideshowPage,
  deckConfig,
  initSlideshowState,
  type SlideshowDefinition,
  type SlideshowStateMap,
} from "./skinSlideshow";
import type { SlideshowPresentation } from "../types/skin";

export interface SkinSlideshowStateApi {
  state: SlideshowStateMap;
  presentations: Record<string, SlideshowPresentation>;
  setDeck: (id: string, deck: string) => void;
  prev: (id: string) => void;
  next: (id: string) => void;
  reset: () => void;
}

const EMPTY_STATE: SlideshowStateMap = {};
const EMPTY_PRESENTATIONS: Record<string, SlideshowPresentation> = {};

const SkinSlideshowStateContext = createContext<SkinSlideshowStateApi>({
  state: EMPTY_STATE,
  presentations: EMPTY_PRESENTATIONS,
  setDeck: () => {},
  prev: () => {},
  next: () => {},
  reset: () => {},
});

let activeSlideshowStateApi: SkinSlideshowStateApi | null = null;

export function getSkinSlideshowStateApi(): SkinSlideshowStateApi | null {
  return activeSlideshowStateApi;
}

export function SkinSlideshowStateProvider({
  definitions,
  children,
}: {
  definitions: SlideshowDefinition[];
  children: ReactNode;
}) {
  const [state, setState] = useState(() => initSlideshowState(definitions));

  const reset = useCallback(() => {
    setState(initSlideshowState(definitions));
  }, [definitions]);

  const presentations = useMemo(() => {
    const map: Record<string, SlideshowPresentation> = {};
    for (const def of definitions) {
      map[def.id] = def.presentation;
    }
    return map;
  }, [definitions]);

  const setDeck = useCallback((id: string, deck: string) => {
    setState((prev) => {
      const presentation = presentations[id];
      if (!presentation?.decks[deck]) return prev;
      return {
        ...prev,
        [id]: { deck, page: 1 },
      };
    });
  }, [presentations]);

  const prev = useCallback((id: string) => {
    setState((prevState) => {
      const runtime = prevState[id];
      const presentation = presentations[id];
      if (!runtime?.deck || !presentation) return prevState;

      const deck = deckConfig(presentation, runtime.deck);
      if (!deck) return prevState;

      return {
        ...prevState,
        [id]: {
          ...runtime,
          page: clampSlideshowPage(runtime.page - 1, deck.pages),
        },
      };
    });
  }, [presentations]);

  const next = useCallback((id: string) => {
    setState((prevState) => {
      const runtime = prevState[id];
      const presentation = presentations[id];
      if (!runtime?.deck || !presentation) return prevState;

      const deck = deckConfig(presentation, runtime.deck);
      if (!deck) return prevState;

      return {
        ...prevState,
        [id]: {
          ...runtime,
          page: clampSlideshowPage(runtime.page + 1, deck.pages),
        },
      };
    });
  }, [presentations]);

  const api = useMemo(
    (): SkinSlideshowStateApi => ({
      state,
      presentations,
      setDeck,
      prev,
      next,
      reset,
    }),
    [state, presentations, setDeck, prev, next, reset],
  );

  useEffect(() => {
    activeSlideshowStateApi = api;
    return () => {
      if (activeSlideshowStateApi === api) {
        activeSlideshowStateApi = null;
      }
    };
  }, [api]);

  return (
    <SkinSlideshowStateContext.Provider value={api}>
      {children}
    </SkinSlideshowStateContext.Provider>
  );
}

export function useSkinSlideshowState(): SkinSlideshowStateApi {
  return useContext(SkinSlideshowStateContext);
}
