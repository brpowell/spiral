import { listen } from "@tauri-apps/api/event";
import {
  SKIN_AUX_READY_EVENT,
  type SkinAuxViewEventPayload,
} from "./skinAuxEvents";
const SKIN_AUX_READY_TIMEOUT_MS = 10_000;

export interface SkinAuxReadyWait {
  wait: Promise<void>;
  cancel: () => void;
}

/** Attach a ready listener before creating the aux webview to avoid missing the signal. */
export async function createSkinAuxReadyWait(
  skinId: string,
  viewId: string,
  timeoutMs = SKIN_AUX_READY_TIMEOUT_MS,
): Promise<SkinAuxReadyWait> {
  let resolveReady!: () => void;
  let rejectReady!: (err: Error) => void;

  const wait = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const timer = setTimeout(() => {
    rejectReady(
      new Error(`Timed out waiting for aux view "${viewId}" ready signal`),
    );
  }, timeoutMs);

  const unlisten = await listen<SkinAuxViewEventPayload>(
    SKIN_AUX_READY_EVENT,
    (event) => {
      const payload = event.payload;
      if (payload.skinId === skinId && payload.viewId === viewId) {
        clearTimeout(timer);
        unlisten();
        resolveReady();
      }
    },
  );

  return {
    wait,
    cancel: () => {
      clearTimeout(timer);
      unlisten();
    },
  };
}
