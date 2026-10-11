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
  clampScrollStripSlide,
  initScrollStripState,
  scrollStripSlideCount,
  type ScrollStripDefinition,
  type ScrollStripStateMap,
} from "./skinScrollStrip";
import type { ScrollStripPresentation } from "../types/skin";

export interface SkinScrollStripStateApi {
  state: ScrollStripStateMap;
  presentations: Record<string, ScrollStripPresentation>;
  prev: (id: string) => void;
  next: (id: string) => void;
  setSlide: (id: string, slide: number) => void;
  reset: () => void;
}

const EMPTY_STATE: ScrollStripStateMap = {};
const EMPTY_PRESENTATIONS: Record<string, ScrollStripPresentation> = {};

const SkinScrollStripStateContext = createContext<SkinScrollStripStateApi>({
  state: EMPTY_STATE,
  presentations: EMPTY_PRESENTATIONS,
  prev: () => {},
  next: () => {},
  setSlide: () => {},
  reset: () => {},
});

let activeScrollStripStateApi: SkinScrollStripStateApi | null = null;

export function getSkinScrollStripStateApi(): SkinScrollStripStateApi | null {
  return activeScrollStripStateApi;
}

export function SkinScrollStripStateProvider({
  definitions,
  children,
}: {
  definitions: ScrollStripDefinition[];
  children: ReactNode;
}) {
  const [state, setState] = useState(() => initScrollStripState(definitions));

  const reset = useCallback(() => {
    setState(initScrollStripState(definitions));
  }, [definitions]);

  const presentations = useMemo(() => {
    const map: Record<string, ScrollStripPresentation> = {};
    for (const def of definitions) {
      map[def.id] = def.presentation;
    }
    return map;
  }, [definitions]);

  const prev = useCallback((id: string) => {
    setState((prevState) => {
      const presentation = presentations[id];
      const runtime = prevState[id];
      if (!presentation || !runtime) return prevState;

      return {
        ...prevState,
        [id]: {
          slide: clampScrollStripSlide(
            runtime.slide - 1,
            scrollStripSlideCount(presentation),
          ),
        },
      };
    });
  }, [presentations]);

  const next = useCallback((id: string) => {
    setState((prevState) => {
      const presentation = presentations[id];
      const runtime = prevState[id];
      if (!presentation || !runtime) return prevState;

      return {
        ...prevState,
        [id]: {
          slide: clampScrollStripSlide(
            runtime.slide + 1,
            scrollStripSlideCount(presentation),
          ),
        },
      };
    });
  }, [presentations]);

  const setSlide = useCallback((id: string, slide: number) => {
    setState((prevState) => {
      const presentation = presentations[id];
      if (!presentation || !prevState[id]) return prevState;

      return {
        ...prevState,
        [id]: {
          slide: clampScrollStripSlide(slide, scrollStripSlideCount(presentation)),
        },
      };
    });
  }, [presentations]);

  const api = useMemo(
    (): SkinScrollStripStateApi => ({
      state,
      presentations,
      prev,
      next,
      setSlide,
      reset,
    }),
    [state, presentations, prev, next, setSlide, reset],
  );

  useEffect(() => {
    activeScrollStripStateApi = api;
    return () => {
      if (activeScrollStripStateApi === api) {
        activeScrollStripStateApi = null;
      }
    };
  }, [api]);

  return (
    <SkinScrollStripStateContext.Provider value={api}>
      {children}
    </SkinScrollStripStateContext.Provider>
  );
}

export function useSkinScrollStripState(): SkinScrollStripStateApi {
  return useContext(SkinScrollStripStateContext);
}
