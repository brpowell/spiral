import { useEffect } from "react";
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

  useEffect(() => {
    void Promise.all([loadThemes(), loadPacks(), loadSkins()]).catch(
      (err: unknown) => {
        console.error("Failed to load appearance data:", err);
      },
    );
  }, [loadThemes, loadPacks, loadSkins]);

  return <AppearanceShell />;
}
