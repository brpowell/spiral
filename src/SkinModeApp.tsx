import { SkinLayoutRenderer } from "./components/playback/skin/SkinLayoutRenderer";
import { SkinStylesheet } from "./components/playback/skin/SkinStylesheet";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onSkinModeContextMenu } from "./lib/skinModeNativeContextMenu";
import { useSkinAuxWindowPersistence } from "./hooks/useSkinAuxWindowPersistence";
import { useSkinAuxViewStateReset } from "./hooks/useSkinAuxViewStateReset";
import { useSkinModeWindowPersistence } from "./hooks/useSkinModeWindowPersistence";
import {
  applyPackWindowLayout,
  applySwitchViewWindowLayout,
  resolveViewWindowChrome,
} from "./lib/skinModeWindowChrome";
import { applySkinAuxViewWindowLayout } from "./lib/skinAuxWindow";
import { startSkinClickThrough, isSkinPanelInteractionActive } from "./lib/skinClickThrough";
import { listSwitchableViewIds } from "./lib/skinWindowPresentation";
import { usePlaylistStore } from "./store/usePlaylistStore";
import { useSkinStore } from "./store/useSkinStore";
import { isSkinAuxWindow } from "./lib/windowRole";
import "./SkinModeApp.css";

export function SkinModeApp() {
  useSkinModeWindowPersistence();
  useSkinAuxWindowPersistence();
  useSkinAuxViewStateReset();

  const loadPlaylists = usePlaylistStore((s) => s.loadPlaylists);
  const activePack = useSkinStore((s) => s.activePack);
  const activeViewId = useSkinStore((s) => s.activeViewId);
  const packReloadGeneration = useSkinStore((s) => s.packReloadGeneration);
  const prevReloadGeneration = useRef(packReloadGeneration);
  const prevViewIdRef = useRef<string | null>(null);
  const isAux = isSkinAuxWindow();
  const view = activePack?.manifest.views?.[activeViewId];
  const chrome = activePack
    ? resolveViewWindowChrome(activePack, activeViewId)
    : null;
  const resizable = chrome?.resizable !== false;
  const isCanvasLayout = view?.layoutMode === "canvas";
  const switchableViewIds = useMemo(
    () => (activePack && !isAux ? listSwitchableViewIds(activePack) : []),
    [activePack, isAux],
  );
  const useViewLayers = switchableViewIds.length > 1;

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("skin-mode-document");
    return () => root.classList.remove("skin-mode-document");
  }, []);

  useEffect(() => {
    if (isAux) return;
    void loadPlaylists();
  }, [loadPlaylists, isAux]);

  // Headspace-style canvas skins reserve transparent stage margins for panel
  // drawers. Fixed-size views (T3 main/mini/eq aux) match their window exactly
  // and must not toggle OS click-through — it blocks slider/button input.
  const enableClickThrough =
    isCanvasLayout && Boolean(view?.panels) && !isAux;

  const panelOpen = useSkinStore((s) => s.panelOpen);
  const panelRevealed = useSkinStore((s) => s.panelRevealed);
  const panelSettled = useSkinStore((s) => s.panelSettled);
  const suspendClickThroughRef = useRef(false);

  useEffect(() => {
    const suspend = isSkinPanelInteractionActive(
      panelOpen,
      panelRevealed,
      panelSettled,
    );
    suspendClickThroughRef.current = suspend;
    if (suspend && enableClickThrough) {
      void getCurrentWindow().setIgnoreCursorEvents(false);
    }
  }, [panelOpen, panelRevealed, panelSettled, enableClickThrough]);

  useEffect(() => {
    if (!enableClickThrough) return;
    return startSkinClickThrough({
      shouldSuspend: () => suspendClickThroughRef.current,
    });
  }, [enableClickThrough]);

  useLayoutEffect(() => {
    if (!activePack) return;

    const reloaded = packReloadGeneration !== prevReloadGeneration.current;
    prevReloadGeneration.current = packReloadGeneration;
    const viewIdChanged =
      prevViewIdRef.current !== null && prevViewIdRef.current !== activeViewId;
    prevViewIdRef.current = activeViewId;

    if (isAux) {
      void applySkinAuxViewWindowLayout(activePack, activeViewId).catch(
        (err: unknown) => {
          console.error("Failed to apply skin aux window layout:", err);
        },
      );
      return;
    }

    // Sized exclusive/primary switches resize in setView after the UI swap.
    if (viewIdChanged && !reloaded) return;

    const chrome = resolveViewWindowChrome(activePack, activeViewId);
    const useManifestDefaults = reloaded && chrome.resizable === false;

    const applyLayout = useManifestDefaults
      ? applySwitchViewWindowLayout(activePack, activeViewId)
      : applyPackWindowLayout(activePack, activeViewId);

    void applyLayout.catch((err: unknown) => {
      console.error("Failed to apply skin window layout:", err);
    });
  }, [activePack?.summary.id, activeViewId, packReloadGeneration, isAux]);

  return (
    <div className="skin-mode-app" data-resizable={resizable ? "true" : "false"}>
      {activePack ? (
        <div
          className={[
            "skin-mode-app__skin",
            useViewLayers && "skin-mode-app__skin--layered",
          ]
            .filter(Boolean)
            .join(" ")}
          onContextMenu={onSkinModeContextMenu}
        >
          <SkinStylesheet pack={activePack} />
          {useViewLayers ? (
            switchableViewIds.map((viewId) => {
              const isActive = viewId === activeViewId;
              return (
                <div
                  key={viewId}
                  className={[
                    "skin-view-layer",
                    isActive
                      ? "skin-view-layer--active"
                      : "skin-view-layer--inactive",
                  ].join(" ")}
                  aria-hidden={!isActive}
                >
                  <SkinLayoutRenderer
                    pack={activePack}
                    viewId={viewId}
                    registerGlobalApi={isActive}
                  />
                </div>
              );
            })
          ) : (
            <SkinLayoutRenderer
              pack={activePack}
              viewId={activeViewId}
              registerGlobalApi
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
