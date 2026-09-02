import { emit } from "@tauri-apps/api/event";
import { getSkinAuxContext, isSkinAuxWindow } from "./windowRole";
import { resetSkinViewRuntimeState } from "./skinViewRuntimeState";

export const SKIN_AUX_READY_EVENT = "skin-aux://ready";

export interface SkinAuxViewEventPayload {
  skinId: string;
  viewId: string;
}

export function emitSkinAuxReady(skinId: string, viewId: string): void {
  void emit(SKIN_AUX_READY_EVENT, {
    skinId,
    viewId,
  } satisfies SkinAuxViewEventPayload);
}

export const SKIN_AUX_RESET_EVENT = "skin-aux://reset";

/** Fired in the aux webview after `window.show()` so `onActivate` can run. */
export const SKIN_AUX_SHOWN_EVENT = "skin-aux://shown";

export function emitSkinAuxShown(skinId: string, viewId: string): void {
  void emit(SKIN_AUX_SHOWN_EVENT, {
    skinId,
    viewId,
  } satisfies SkinAuxViewEventPayload);
}

function emitSkinAuxReset(skinId: string, viewId: string): void {
  void emit(SKIN_AUX_RESET_EVENT, {
    skinId,
    viewId,
  } satisfies SkinAuxViewEventPayload);
}

/** Notify aux webviews to reset; also reset immediately when called from the target aux window. */
export function signalSkinAuxViewReset(skinId: string, viewId: string): void {
  emitSkinAuxReset(skinId, viewId);
  const ctx = getSkinAuxContext();
  if (isSkinAuxWindow() && ctx?.skinId === skinId && ctx.viewId === viewId) {
    resetSkinViewRuntimeState();
  }
}
