import { useCallback, useState } from "react";

export type AppearanceThemeEditorSession = {
  themeId: string;
};

export function useAppearanceThemeEditor() {
  const [session, setSession] = useState<AppearanceThemeEditorSession | null>(
    null,
  );

  const openEditor = useCallback((themeId: string) => {
    setSession({ themeId });
  }, []);

  const closeEditor = useCallback(() => {
    setSession(null);
  }, []);

  return { session, openEditor, closeEditor };
}
