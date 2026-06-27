import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import {
  SKIN_AUX_RESET_EVENT,
  type SkinAuxViewEventPayload,
} from "../lib/skinAuxEvents";
import { resetSkinViewRuntimeState } from "../lib/skinViewRuntimeState";
import { getSkinAuxContext, isSkinAuxWindow } from "../lib/windowRole";

export function useSkinAuxViewStateReset(): void {
  useEffect(() => {
    if (!isSkinAuxWindow()) return;

    const auxContext = getSkinAuxContext();
    if (!auxContext) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void listen(SKIN_AUX_RESET_EVENT, (event) => {
      const payload = event.payload as SkinAuxViewEventPayload;
      if (
        payload.skinId !== auxContext.skinId ||
        payload.viewId !== auxContext.viewId
      ) {
        return;
      }
      resetSkinViewRuntimeState();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
