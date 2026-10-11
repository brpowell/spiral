import { createContext, useContext, type ReactNode } from "react";
import type { SkinLayoutContext as SkinLayoutContextValue } from "../../../lib/skinLayout";

const defaultValue: SkinLayoutContextValue = {
  origin: { x: 0, y: 0 },
  size: { width: 0, height: 0 },
  space: "stage",
};

const SkinLayoutContext = createContext<SkinLayoutContextValue>(defaultValue);

export function useSkinLayoutContext(): SkinLayoutContextValue {
  return useContext(SkinLayoutContext);
}

export function SkinLayoutContextProvider({
  value,
  children,
}: {
  value: SkinLayoutContextValue;
  children: ReactNode;
}) {
  return (
    <SkinLayoutContext.Provider value={value}>{children}</SkinLayoutContext.Provider>
  );
}
