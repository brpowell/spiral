import { SkinLayoutRenderer } from "./components/playback/skin/SkinLayoutRenderer";
import { SkinStylesheet } from "./components/playback/skin/SkinStylesheet";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useSkinAuxWindowPersistence } from "./hooks/useSkinAuxWindowPersistence";
import { useSkinAuxViewStateReset } from "./hooks/useSkinAuxViewStateReset";
import { useSkinModeContextMenu } from "./hooks/useSkinModeContextMenu";
import { useSkinModeWindowPersistence } from "./hooks/useSkinModeWindowPersistence";
import {
  applyPackWindowLayout,
  applySwitchViewWindowLayout,
  resolveViewWindowChrome,
} from "./lib/skinModeWindowChrome";
import { applySkinAuxViewWindowLayout } from "./lib/skinAuxWindow";
import { startSkinClickThrough } from "./lib/skinClickThrough";
import { isViewStateMotionActive } from "./lib/skinViewStateEvents";
import { getSkinViewStateApi } from "./lib/skinViewStateContext";
import { startSkinDragRegions } from "./lib/skinDragRegion";
import { listSwitchableViewIds } from "./lib/skinWindowPresentation";
import { usePlaylistStore } from "./store/usePlaylistStore";
import { useSkinStore } from "./store/useSkinStore";
import { isSkinAuxWindow } from "./lib/windowRole";
import "./SkinModeApp.css";

export function SkinModeApp() {
  useSkinModeWindowPersistence();
  useSkinAuxWindowPersistence();
  useSkinAuxViewStateReset();

  const { onContextMenu, contextMenu } = useSkinModeContextMenu();
  const loadPlaylists = usePlaylistStore((s) => s.loadPlaylists);
  const activePack = useSkinStore((s) => s.activePack);
  const activeViewId = useSkinStore((s) => s.activeViewId);
  const packReloadGeneration = useSkinStore((s) => s.packReloadGeneration);
  const skinSwapPending = useSkinStore((s) => s.skinSwapPending);
  const prevReloadGeneration = useRef(packReloadGeneration);
  const prevViewIdRef = useRef<string | null>(null);
  const prevSkinIdRef = useRef<string | null>(null);
  const isAux = isSkinAuxWindow();
  const view = activePack?.manifest.views?.[activeViewId];
  const chrome = activePack
    ? resolveViewWindowChrome(activePack, activeViewId)
    : null;
  const resizable = chrome?.resizable !== false;
  const isCanvasLayout = view?.layout.type === "canvas";
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

  // Canvas skins use a transparent frameless window. Click-through follows
  // opaque artwork and control bounds so irregular silhouettes (Headspace)
  // pass clicks to the desktop. Controls stay AABB-solid so sliders/buttons
  // are never stolen by OS pass-through.
  const enableClickThrough = isCanvasLayout;

  useEffect(() => {
    if (!enableClickThrough) return;
    return startSkinClickThrough({
      shouldSuspend: () =>
        isViewStateMotionActive(getSkinViewStateApi()?.values),
    });
  }, [enableClickThrough]);

  useEffect(() => startSkinDragRegions(), []);

  useLayoutEffect(() => {
    if (!activePack) return;

    const reloaded = packReloadGeneration !== prevReloadGeneration.current;
    prevReloadGeneration.current = packReloadGeneration;
    const skinId = activePack.summary.id;
    const skinIdChanged =
      prevSkinIdRef.current !== null && prevSkinIdRef.current !== skinId;
    prevSkinIdRef.current = skinId;
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

    // Skin switches resize in the store swap path before the new pack paints.
    if (skinIdChanged && !reloaded) return;

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
    // Depend on skin id, not pack object identity — reloads bump packReloadGeneration.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activePack used for layout apply only
  }, [activePack?.summary.id, activeViewId, packReloadGeneration, isAux]);

  return (
    <div
      className="skin-mode-app"
      data-resizable={resizable ? "true" : "false"}
    >
      {activePack ? (
        <div
          className={[
            "skin-mode-app__skin",
            useViewLayers && "skin-mode-app__skin--layered",
            skinSwapPending && "skin-mode-app__skin--swap-pending",
          ]
            .filter(Boolean)
            .join(" ")}
          onContextMenu={onContextMenu}
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
                  {...(!isActive ? { inert: true } : {})}
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
      {contextMenu}
    </div>
  );
}
