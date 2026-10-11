import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import {
  SKIN_AUX_RESET_EVENT,
  SKIN_AUX_SHOWN_EVENT,
  type SkinAuxViewEventPayload,
} from "../lib/skinAuxEvents";
import { SKIN_MODE_SHOWN_EVENT } from "../lib/skinModeWindow";
import {
  getSkinAuxContext,
  isSkinAuxWindow,
  isSkinModeWindow,
} from "../lib/windowRole";

/** True once this skin view's window is visible (skin-mode or auxiliary). */
export function useSkinModeShown(enabled: boolean): boolean {
  const [skinModeShown, setSkinModeShown] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    if (isSkinModeWindow()) {
      let cancelled = false;
      let unlisten: (() => void) | undefined;

      void getCurrentWindow()
        .isVisible()
        .then((visible) => {
          if (!cancelled && visible) setSkinModeShown(true);
        });

      void listen(SKIN_MODE_SHOWN_EVENT, () => {
        setSkinModeShown(true);
      }).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

      return () => {
        cancelled = true;
        unlisten?.();
      };
    }

    if (!isSkinAuxWindow()) return;

    const auxContext = getSkinAuxContext();
    if (!auxContext) return;

    let cancelled = false;
    let unlistenShown: (() => void) | undefined;
    let unlistenReset: (() => void) | undefined;

    const matches = (payload: SkinAuxViewEventPayload) =>
      payload.skinId === auxContext.skinId &&
      payload.viewId === auxContext.viewId;

    const syncVisible = () => {
      void getCurrentWindow()
        .isVisible()
        .then((visible) => {
          if (!cancelled) setSkinModeShown(visible);
        });
    };

    syncVisible();

    void listen<SkinAuxViewEventPayload>(SKIN_AUX_SHOWN_EVENT, (event) => {
      if (matches(event.payload)) setSkinModeShown(true);
    }).then((fn) => {
      if (cancelled) fn();
      else {
        unlistenShown = fn;
        // Window may already be visible if show beat the listener attach.
        syncVisible();
      }
    });

    void listen<SkinAuxViewEventPayload>(SKIN_AUX_RESET_EVENT, (event) => {
      if (matches(event.payload)) setSkinModeShown(false);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenReset = fn;
    });

    return () => {
      cancelled = true;
      unlistenShown?.();
      unlistenReset?.();
    };
  }, [enabled]);

  return skinModeShown;
}
