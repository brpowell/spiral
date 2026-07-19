import { useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppearanceShell } from "./components/Appearance/AppearanceShell";
import { BackgroundTasksIndicator } from "./components/BackgroundTasks/BackgroundTasksIndicator";
import { useAppearanceWindowClose } from "./hooks/useAppearanceWindowClose";
import { RELOAD_LINKED_PACKS_EVENT } from "./lib/appearanceWindow";
import { refreshPackContributionStores } from "./lib/packs/refreshPackStores";
import { useSkinStore } from "./store/useSkinStore";
import { useThemeStore } from "./store/useThemeStore";
import { useVisualizerStore } from "./store/useVisualizerStore";
import "./AppearanceApp.css";

export function AppearanceApp() {
  useAppearanceWindowClose();

  const loadThemes = useThemeStore((s) => s.loadThemes);
  const loadVisualizers = useVisualizerStore((s) => s.loadVisualizers);
  const loadSkins = useSkinStore((s) => s.loadSkins);

  const refreshAppearanceData = useCallback(async () => {
    await Promise.all([loadThemes(), loadVisualizers(), loadSkins()]);
  }, [loadThemes, loadVisualizers, loadSkins]);

  useEffect(() => {
    void refreshAppearanceData().catch((err: unknown) => {
      console.error("Failed to load appearance data:", err);
    });
  }, [refreshAppearanceData]);

  // Menu / Cmd+Alt+R runs in the main webview; sync Studio stores without a
  // second toast (main already shows success/error).
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen(RELOAD_LINKED_PACKS_EVENT, () => {
      void refreshPackContributionStores().catch((err: unknown) => {
        console.error("Failed to refresh packs after linked reload:", err);
      });
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // No focus-driven refresh: OS color pickers / dialogs blur+refocus the window
  // and would thrash the theme editor. Cross-window updates arrive via bridges
  // (theme://changed, workshop://changed, skin events, etc.).

  return (
    <>
      <AppearanceShell />
      <BackgroundTasksIndicator />
    </>
  );
}
