import { createContext, useContext, type ReactNode } from "react";

interface AppearanceThemeEditorContextValue {
  openThemeEditor: (themeId: string) => void;
}

const AppearanceThemeEditorContext =
  createContext<AppearanceThemeEditorContextValue | null>(null);

export function AppearanceThemeEditorProvider({
  children,
  openThemeEditor,
}: {
  children: ReactNode;
  openThemeEditor: AppearanceThemeEditorContextValue["openThemeEditor"];
}) {
  return (
    <AppearanceThemeEditorContext.Provider value={{ openThemeEditor }}>
      {children}
    </AppearanceThemeEditorContext.Provider>
  );
}

export function useOpenAppearanceThemeEditor() {
  const ctx = useContext(AppearanceThemeEditorContext);
  if (!ctx) {
    throw new Error(
      "useOpenAppearanceThemeEditor must be used within AppearanceThemeEditorProvider",
    );
  }
  return ctx.openThemeEditor;
}
