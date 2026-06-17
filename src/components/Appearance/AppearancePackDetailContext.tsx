import { createContext, useContext, type ReactNode } from "react";
import type { AppearancePackRef } from "../../hooks/useAppearancePackDetail";

interface AppearancePackDetailContextValue {
  openDetail: (ref: AppearancePackRef) => void;
}

const AppearancePackDetailContext =
  createContext<AppearancePackDetailContextValue | null>(null);

export function AppearancePackDetailProvider({
  children,
  openDetail,
}: {
  children: ReactNode;
  openDetail: AppearancePackDetailContextValue["openDetail"];
}) {
  return (
    <AppearancePackDetailContext.Provider value={{ openDetail }}>
      {children}
    </AppearancePackDetailContext.Provider>
  );
}

export function useOpenAppearancePackDetail() {
  const ctx = useContext(AppearancePackDetailContext);
  if (!ctx) {
    throw new Error(
      "useOpenAppearancePackDetail must be used within AppearancePackDetailProvider",
    );
  }
  return ctx.openDetail;
}
