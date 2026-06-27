import { listen } from "@tauri-apps/api/event";
import { applySkinChangeWindowLayout } from "./skinModeWindowChrome";
import { closeAllSkinAuxWindows, restoreOpenSkinAuxWindows } from "./skinAuxWindow";
import { isSkinModeVisible } from "./skinModeWindow";
import { resolveViewForPack } from "./skinViewState";
import { useSkinStore } from "../store/useSkinStore";
import { useSkinPreferencesStore } from "../store/useSkinPreferencesStore";
import { useThemeStore } from "../store/useThemeStore";
import { useVisualizerStore } from "../store/useVisualizerStore";
import { APPEARANCE_REFRESH_EVENT } from "./appearanceWindow";
import type { WindowRole } from "./windowRole";
import { isAppearanceWindow, isSkinAuxWindow, isSkinModeWindow } from "./windowRole";

export const SKIN_CHANGED_EVENT = "skin://changed";
export const SKIN_PREFERENCES_CHANGED_EVENT = "skin://preferences-changed";

export interface SkinChangedPayload {
  skinId: string;
  viewId: string;
}

export interface SkinPreferencesChangedPayload {
  skinId: string;
}

async function reloadSkinOnSkinModeWindow(): Promise<void> {
  await useSkinStore.getState().loadSkins();
  const pack = useSkinStore.getState().activePack;
  if (!pack || !(await isSkinModeVisible())) return;
  const viewId = resolveViewForPack(pack);
  await applySkinChangeWindowLayout(pack, viewId);
  await restoreOpenSkinAuxWindows(pack);
}

async function refreshAppearanceData(): Promise<void> {
  await Promise.all([
    useThemeStore.getState().loadThemes(),
    useVisualizerStore.getState().loadPacks(),
    useSkinStore.getState().loadSkins(),
  ]);
}

async function reloadSkinPreferences(skinId: string): Promise<void> {
  const current = useSkinPreferencesStore.getState().skinId;
  if (current !== null && current !== skinId) return;
  await useSkinPreferencesStore.getState().loadForSkin(skinId);
}

async function listenSkinPreferencesChanged(): Promise<void> {
  await listen<SkinPreferencesChangedPayload>(
    SKIN_PREFERENCES_CHANGED_EVENT,
    (event) => {
      void reloadSkinPreferences(event.payload.skinId).catch((err: unknown) => {
        console.error("Failed to reload skin preferences:", err);
      });
    },
  );
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
    await listenSkinPreferencesChanged();
    return;
  }

  if (isSkinAuxWindow()) {
    await listen<SkinChangedPayload>(SKIN_CHANGED_EVENT, async () => {
      const previousPack = useSkinStore.getState().activePack;
      if (previousPack) {
        await closeAllSkinAuxWindows(previousPack);
      }
      await useSkinStore.getState().loadSkins();
    });
    await listenSkinPreferencesChanged();
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
