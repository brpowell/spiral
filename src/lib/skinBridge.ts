import { listen } from "@tauri-apps/api/event";
import { applySkinChangeWindowLayout } from "./skinModeWindowChrome";
import { isSkinModeVisible } from "./skinModeWindow";
import { useSkinStore } from "../store/useSkinStore";
import { useThemeStore } from "../store/useThemeStore";
import { useVisualizerStore } from "../store/useVisualizerStore";
import { APPEARANCE_REFRESH_EVENT } from "./appearanceWindow";
import type { WindowRole } from "./windowRole";
import { isAppearanceWindow, isSkinModeWindow } from "./windowRole";

export const SKIN_CHANGED_EVENT = "skin://changed";

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

async function refreshAppearanceData(): Promise<void> {
  await Promise.all([
    useThemeStore.getState().loadThemes(),
    useVisualizerStore.getState().loadPacks(),
    useSkinStore.getState().loadSkins(),
  ]);
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

  if (isAppearanceWindow()) {
    await listen(APPEARANCE_REFRESH_EVENT, () => {
      void refreshAppearanceData().catch((err: unknown) => {
        console.error("Failed to refresh appearance data:", err);
      });
    });
  }
}
