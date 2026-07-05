import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SkinViewStateSpec } from "../types/skin";

export type ViewStateValues = Record<string, string | number | boolean>;

export interface SkinViewStateApi {
  values: ViewStateValues;
  setVariable: (name: string, value: string | number | boolean) => void;
  setScreen: (screen: string) => void;
  reset: () => void;
}

const EMPTY_VALUES: ViewStateValues = {};

const SkinViewStateContext = createContext<SkinViewStateApi>({
  values: EMPTY_VALUES,
  setVariable: () => { },
  setScreen: () => { },
  reset: () => { },
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

  const setVariable = useCallback(
    (name: string, value: string | number | boolean) => {
      setValues((prev) => ({ ...prev, [name]: value }));
    },
    [],
  );

  const setScreen = useCallback((screen: string) => {
    setVariable("screen", screen);
  }, [setVariable]);

  const reset = useCallback(() => {
    setValues(defaults);
  }, [defaults]);

  const api = useMemo(
    (): SkinViewStateApi => ({ values, setVariable, setScreen, reset }),
    [values, setVariable, setScreen, reset],
  );

  useEffect(() => {
    if (!registerGlobalApi) return;

    activeViewStateApi = api;
    return () => {
      if (activeViewStateApi === api) {
        activeViewStateApi = null;
      }
    };
  }, [api, registerGlobalApi]);

  return (
    <SkinViewStateContext.Provider value={api}>
      {children}
    </SkinViewStateContext.Provider>
  );
}

export function useSkinViewState(): SkinViewStateApi {
  return useContext(SkinViewStateContext);
}
