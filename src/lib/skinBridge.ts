import { listen } from "@tauri-apps/api/event";
import { applySkinChangeWindowLayout } from "./skinModeWindowChrome";
import { isSkinModeVisible } from "./skinModeWindow";
import { useSkinStore } from "../store/useSkinStore";
import type { WindowRole } from "./windowRole";
import { isSkinModeWindow, isSkinPickerWindow } from "./windowRole";

export const SKIN_CHANGED_EVENT = "skin://changed";
export const SKIN_PICKER_REFRESH_EVENT = "skin://picker-refresh";

export interface SkinChangedPayload {
  skinId: string;
  viewId: string;
}

async function reloadSkinOnSkinModeWindow(): Promise<void> {
  await useSkinStore.getState().loadSkins();
  const pack = useSkinStore.getState().activePack;
  if (pack && (await isSkinModeVisible())) {
    await applySkinChangeWindowLayout(pack);
  }
}

export async function initSkinBridge(role: WindowRole): Promise<void> {
  if (role === "main") {
    return;
  }

  if (isSkinModeWindow()) {
    await listen<SkinChangedPayload>(SKIN_CHANGED_EVENT, () => {
      void reloadSkinOnSkinModeWindow().catch((err: unknown) => {
        console.error("Failed to apply skin change in skin mode:", err);
      });
    });
    return;
  }

  if (isSkinPickerWindow()) {
    await listen(SKIN_PICKER_REFRESH_EVENT, () => {
      void useSkinStore.getState().loadSkins().catch((err: unknown) => {
        console.error("Failed to refresh skins in picker:", err);
      });
    });
  }
}
