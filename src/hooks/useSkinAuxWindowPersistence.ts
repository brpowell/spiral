import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ensureSkinModeOnVisibleMonitor } from "../lib/skinModeWindow";
import { removeOpenAuxView } from "../lib/skinAuxViewState";
import { signalSkinAuxViewReset } from "../lib/skinAuxEvents";
import { persistSkinAuxWindowState } from "../lib/skinAuxWindow";
import { isSkinModeSnapSuppressed } from "../lib/skinModeWindowChrome";
import { useSkinStore } from "../store/useSkinStore";
import { isSkinAuxWindow } from "../lib/windowRole";

const SAVE_DEBOUNCE_MS = 500;

export function useSkinAuxWindowPersistence(): void {
  const isAux = isSkinAuxWindow();
  const activePack = useSkinStore((s) => s.activePack);
  const activeViewId = useSkinStore((s) => s.activeViewId);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAux) return;
    void ensureSkinModeOnVisibleMonitor().catch((err: unknown) => {
      console.error("Failed to validate skin aux monitor:", err);
    });

    const scheduleSave = () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        const { activePack: pack, activeViewId: viewId } =
          useSkinStore.getState();
        if (!pack) return;
        void persistSkinAuxWindowState(pack, viewId, getCurrentWindow()).catch(
          (err: unknown) => {
            console.error("Failed to persist skin aux window state:", err);
          },
        );
      }, SAVE_DEBOUNCE_MS);
    };

    let unlistenMove: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWindow()
      .onMoved(() => {
        if (!isSkinModeSnapSuppressed()) scheduleSave();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenMove = fn;
      });

    void getCurrentWindow()
      .onResized(() => scheduleSave())
      .then((fn) => {
        if (cancelled) fn();
        else unlistenResize = fn;
      });

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (saveTimerRef.current !== null) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        const { activePack: pack, activeViewId: viewId } =
          useSkinStore.getState();
        if (!pack) return;
        try {
          await persistSkinAuxWindowState(pack, viewId, getCurrentWindow());
        } catch (err) {
          console.error("Failed to persist skin aux on close:", err);
        }
        removeOpenAuxView(pack.summary.id, viewId);
        signalSkinAuxViewReset(pack.summary.id, viewId);
        await getCurrentWindow().hide();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenClose = fn;
      });

    return () => {
      cancelled = true;
      unlistenMove?.();
      unlistenResize?.();
      unlistenClose?.();
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [isAux, activePack?.summary.id, activeViewId]);
}
