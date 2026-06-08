import { SkinLayoutRenderer } from "./components/playback/skin/SkinLayoutRenderer";
import { SkinStylesheet } from "./components/playback/skin/SkinStylesheet";
import { useLayoutEffect } from "react";
import { onSkinModeContextMenu } from "./lib/skinModeNativeContextMenu";
import { useSkinModeWindowPersistence } from "./hooks/useSkinModeWindowPersistence";
import { applyPackWindowLayout } from "./lib/skinModeWindowChrome";
import { useSkinStore } from "./store/useSkinStore";
import "./SkinModeApp.css";

export function SkinModeApp() {
  useSkinModeWindowPersistence();
  const activePack = useSkinStore((s) => s.activePack);
  const activeViewId = useSkinStore((s) => s.activeViewId);
  const resizable = activePack
    ? activePack.manifest.window?.resizable !== false
    : false;

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("skin-mode-document");
    return () => root.classList.remove("skin-mode-document");
  }, []);

  useLayoutEffect(() => {
    if (!activePack) return;
    void applyPackWindowLayout(activePack).catch((err: unknown) => {
      console.error("Failed to apply skin window layout:", err);
    });
  }, [activePack?.summary.id]);

  return (
    <div className="skin-mode-app" data-resizable={resizable ? "true" : "false"}>
      {activePack ? (
        <div className="skin-mode-app__skin" onContextMenu={onSkinModeContextMenu}>
          <SkinStylesheet pack={activePack} />
          <SkinLayoutRenderer pack={activePack} viewId={activeViewId} />
        </div>
      ) : null}
    </div>
  );
}
