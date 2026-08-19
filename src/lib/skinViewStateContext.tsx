import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SkinViewStateSpec } from "../types/skin";

export type ViewStateValues = Record<string, string | number | boolean>;

/** `data-view-{name}` attrs for CSS. Put these on a descendant of `[data-skin-id]`. */
export function viewStateDataAttributes(
  values: ViewStateValues,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    attrs[`data-view-${name}`] = String(value);
  }
  return attrs;
}

export interface SkinViewStateApi {
  values: ViewStateValues;
  setVariable: (name: string, value: string | number | boolean) => void;
  setScreen: (screen: string) => void;
  reset: () => void;
}

const EMPTY_VALUES: ViewStateValues = {};

const SkinViewStateContext = createContext<SkinViewStateApi>({
  values: EMPTY_VALUES,
  setVariable: () => {},
  setScreen: () => {},
  reset: () => {},
});

let activeViewStateApi: SkinViewStateApi | null = null;

/** Imperative access for `runSkinAction` (active primary skin-mode view). */
export function getSkinViewStateApi(): SkinViewStateApi | null {
  return activeViewStateApi;
}

export function initViewStateDefaults(
  state?: Record<string, SkinViewStateSpec>,
): ViewStateValues {
  if (!state) return {};
  const values: ViewStateValues = {};
  for (const [name, spec] of Object.entries(state)) {
    values[name] = spec.default;
  }
  return values;
}

export function evaluateViewBind(
  path: string,
  values: ViewStateValues,
): boolean | string | number | null {
  if (!path.startsWith("view.")) return null;

  const rest = path.slice("view.".length);
  const dot = rest.indexOf(".");
  if (dot === -1) {
    return values[rest] ?? null;
  }

  const varName = rest.slice(0, dot);
  const expected = rest.slice(dot + 1);
  const actual = values[varName];
  if (actual === undefined) return false;
  return String(actual) === expected;
}

export function SkinViewStateProvider({
  defaults,
  registerGlobalApi = false,
  children,
}: {
  defaults: ViewStateValues;
  /** When false, this provider does not publish to `getSkinViewStateApi()`. */
  registerGlobalApi?: boolean;
  children: ReactNode;
}) {
  const [values, setValues] = useState(defaults);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const setVariable = useCallback(
    (name: string, value: string | number | boolean) => {
      setValues((prev) => {
        if (prev[name] === value) return prev;
        const next = { ...prev, [name]: value };
        valuesRef.current = next;
        return next;
      });
    },
    [],
  );

  const setScreen = useCallback(
    (screen: string) => {
      setVariable("screen", screen);
    },
    [setVariable],
  );

  const reset = useCallback(() => {
    valuesRef.current = defaults;
    setValues(defaults);
  }, [defaults]);

  const setVariableRef = useRef(setVariable);
  const setScreenRef = useRef(setScreen);
  const resetRef = useRef(reset);
  setVariableRef.current = setVariable;
  setScreenRef.current = setScreen;
  resetRef.current = reset;

  const api = useMemo(
    (): SkinViewStateApi => ({ values, setVariable, setScreen, reset }),
    [values, setVariable, setScreen, reset],
  );

  useEffect(() => {
    if (!registerGlobalApi) return;

    const globalApi: SkinViewStateApi = {
      get values() {
        return valuesRef.current;
      },
      setVariable: (name, value) => setVariableRef.current(name, value),
      setScreen: (screen) => setScreenRef.current(screen),
      reset: () => resetRef.current(),
    };
    activeViewStateApi = globalApi;
    return () => {
      if (activeViewStateApi === globalApi) {
        activeViewStateApi = null;
      }
    };
  }, [registerGlobalApi]);

  return (
    <SkinViewStateContext.Provider value={api}>
      {children}
    </SkinViewStateContext.Provider>
  );
}

export function useSkinViewState(): SkinViewStateApi {
  return useContext(SkinViewStateContext);
}
