import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { snapSkinModeWindow } from "../lib/skinModeSnap";
import {
  ensureSkinModeOnVisibleMonitor,
  persistSkinModeWindowState,
  restoreMainWindow,
} from "../lib/skinModeWindow";
import { isSkinModeSnapSuppressed } from "../lib/skinModeWindowChrome";
import { useSkinStore } from "../store/useSkinStore";

const SAVE_DEBOUNCE_MS = 500;

export function useSkinModeWindowPersistence(): void {
  const skinId = useSkinStore((s) => s.activeSkinId);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void ensureSkinModeOnVisibleMonitor().catch((err: unknown) => {
      console.error("Failed to validate skin mode monitor:", err);
    });

    const scheduleSave = (
      snapResult?: Parameters<typeof persistSkinModeWindowState>[1],
    ) => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        const id = useSkinStore.getState().activeSkinId;
        void persistSkinModeWindowState(id, snapResult).catch(
          (err: unknown) => {
            console.error("Failed to persist skin mode window state:", err);
          },
        );
      }, SAVE_DEBOUNCE_MS);
    };

    const scheduleSnap = () => {
      if (isSkinModeSnapSuppressed()) return;

      if (snapTimerRef.current !== null) {
        clearTimeout(snapTimerRef.current);
      }
      snapTimerRef.current = setTimeout(() => {
        snapTimerRef.current = null;
        if (isSkinModeSnapSuppressed()) return;

        void snapSkinModeWindow()
          .then((result) => {
            if (result) {
              scheduleSave({
                snapEdge: result.snapEdge,
                monitorName: result.monitorName,
                scaleFactor: result.scaleFactor,
              });
            } else {
              scheduleSave();
            }
          })
          .catch((err: unknown) => {
            console.error("Failed to snap skin mode window:", err);
            scheduleSave();
          });
      }, 120);
    };

    let unlistenMove: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWindow()
      .onMoved(() => scheduleSnap())
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
        if (snapTimerRef.current !== null) {
          clearTimeout(snapTimerRef.current);
          snapTimerRef.current = null;
        }
        try {
          const id = useSkinStore.getState().activeSkinId;
          const snapResult = await snapSkinModeWindow();
          await persistSkinModeWindowState(
            id,
            snapResult
              ? {
                  snapEdge: snapResult.snapEdge,
                  monitorName: snapResult.monitorName,
                  scaleFactor: snapResult.scaleFactor,
                }
              : undefined,
          );
        } catch (err) {
          console.error("Failed to persist skin mode on close:", err);
        } finally {
          await restoreMainWindow();
        }
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
      if (snapTimerRef.current !== null) {
        clearTimeout(snapTimerRef.current);
      }
    };
  }, [skinId]);
}
