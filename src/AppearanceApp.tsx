import { useCallback, useEffect } from "react";
import { AppearanceShell } from "./components/Appearance/AppearanceShell";
import { useAppearanceWindowClose } from "./hooks/useAppearanceWindowClose";
import { useSkinStore } from "./store/useSkinStore";
import { useThemeStore } from "./store/useThemeStore";
import { useVisualizerStore } from "./store/useVisualizerStore";
import "./AppearanceApp.css";

export function AppearanceApp() {
  useAppearanceWindowClose();

  const loadThemes = useThemeStore((s) => s.loadThemes);
  const loadPacks = useVisualizerStore((s) => s.loadPacks);
  const loadSkins = useSkinStore((s) => s.loadSkins);

  const refreshAppearanceData = useCallback(async () => {
    await Promise.all([loadThemes(), loadPacks(), loadSkins()]);
  }, [loadThemes, loadPacks, loadSkins]);

  useEffect(() => {
    void refreshAppearanceData().catch((err: unknown) => {
      console.error("Failed to load appearance data:", err);
    });
  }, [refreshAppearanceData]);

  useEffect(() => {
    const onFocus = () => {
      void refreshAppearanceData().catch((err: unknown) => {
        console.error("Failed to refresh appearance data:", err);
      });
    };

    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshAppearanceData]);

  return <AppearanceShell />;
}
