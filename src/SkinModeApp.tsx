import { SkinLayoutRenderer } from "./components/playback/skin/SkinLayoutRenderer";
import { SkinStylesheet } from "./components/playback/skin/SkinStylesheet";
import { useEffect, useLayoutEffect } from "react";
import { onSkinModeContextMenu } from "./lib/skinModeNativeContextMenu";
import { useSkinModeWindowPersistence } from "./hooks/useSkinModeWindowPersistence";
import { applyPackWindowLayout } from "./lib/skinModeWindowChrome";
import { startSkinClickThrough } from "./lib/skinClickThrough";
import { usePlaylistStore } from "./store/usePlaylistStore";
import { useSkinStore } from "./store/useSkinStore";
import "./SkinModeApp.css";

export function SkinModeApp() {
  useSkinModeWindowPersistence();
  const loadPlaylists = usePlaylistStore((s) => s.loadPlaylists);
  const activePack = useSkinStore((s) => s.activePack);
  const activeViewId = useSkinStore((s) => s.activeViewId);
  const resizable = activePack
    ? activePack.manifest.window?.resizable !== false
    : false;
  const isCanvasLayout =
    activePack?.manifest.views?.[activeViewId]?.layoutMode === "canvas";

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("skin-mode-document");
    return () => root.classList.remove("skin-mode-document");
  }, []);

  useEffect(() => {
    void loadPlaylists();
  }, [loadPlaylists]);

  // Canvas skins reserve transparent stage margins for panel drawers; pass
  // clicks in those empty areas through to windows behind the skin.
  useEffect(() => {
    if (!isCanvasLayout) return;
    return startSkinClickThrough();
  }, [isCanvasLayout]);

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
