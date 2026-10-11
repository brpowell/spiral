import { listen } from "@tauri-apps/api/event";
import { closeAllSkinAuxWindows } from "./skinAuxWindow";
import { useSkinStore } from "../store/useSkinStore";
import { useSkinPreferencesStore } from "../store/useSkinPreferencesStore";
import { useThemeStore } from "../store/useThemeStore";
import { useVisualizerStore } from "../store/useVisualizerStore";
import type { SkinUserPreferences } from "../types/skinPreferences";
import { APPEARANCE_REFRESH_EVENT } from "./appearanceWindow";
import type { WindowRole } from "./windowRole";
import {
  isAppearanceWindow,
  isSkinAuxWindow,
  isSkinModeWindow,
} from "./windowRole";

export const SKIN_CHANGED_EVENT = "skin://changed";
export const SKIN_PREFERENCES_CHANGED_EVENT = "skin://preferences-changed";
export const SKIN_PREFERENCES_ACTION_EVENT = "skin://preferences-action";

export interface SkinChangedPayload {
  skinId: string;
  viewId: string;
}

export interface SkinPreferencesChangedPayload {
  skinId: string;
  preferences: SkinUserPreferences;
}

export type SkinPreferencesActionPayload =
  | { type: "toggleSoundEffects" }
  | { type: "togglePref"; settingId: string }
  | { type: "setPref"; settingId: string; value: unknown };

/** Whether this window should adopt a preferences snapshot for `eventSkinId`. */
export function shouldApplyRemoteSkinPreferences(
  eventSkinId: string,
  currentSkinId: string | null,
  activeSkinId: string,
): boolean {
  if (currentSkinId === eventSkinId || activeSkinId === eventSkinId) {
    return true;
  }
  return currentSkinId === null;
}

async function refreshAppearanceData(): Promise<void> {
  await Promise.all([
    useThemeStore.getState().loadThemes(),
    useVisualizerStore.getState().loadVisualizers(),
    useSkinStore.getState().loadSkins(),
  ]);
}

function applyRemoteSkinPreferences(
  payload: SkinPreferencesChangedPayload,
): void {
  const { skinId, preferences } = payload;
  const current = useSkinPreferencesStore.getState().skinId;
  const activeSkinId = useSkinStore.getState().activeSkinId;
  if (!shouldApplyRemoteSkinPreferences(skinId, current, activeSkinId)) {
    return;
  }
  useSkinPreferencesStore.setState({ skinId, preferences });
}

async function listenSkinPreferencesChanged(): Promise<void> {
  await listen<SkinPreferencesChangedPayload>(
    SKIN_PREFERENCES_CHANGED_EVENT,
    (event) => {
      applyRemoteSkinPreferences(event.payload);
    },
  );
}

async function listenSkinPreferencesActions(): Promise<void> {
  await listen<SkinPreferencesActionPayload>(
    SKIN_PREFERENCES_ACTION_EVENT,
    (event) => {
      const activeSkinId = useSkinStore.getState().activeSkinId;
      const store = useSkinPreferencesStore.getState();
      switch (event.payload.type) {
        case "toggleSoundEffects":
          void store.toggleSoundEffects(activeSkinId).catch((err: unknown) => {
            console.error("Failed to toggle skin sound effects:", err);
          });
          break;
        case "togglePref":
          void store
            .togglePref(event.payload.settingId, activeSkinId)
            .catch((err: unknown) => {
              console.error("Failed to toggle skin preference:", err);
            });
          break;
        case "setPref":
          void store
            .setPref(
              event.payload.settingId,
              event.payload.value,
              activeSkinId,
            )
            .catch((err: unknown) => {
              console.error("Failed to set skin preference:", err);
            });
          break;
      }
    },
  );
}

export async function initSkinBridge(role: WindowRole): Promise<void> {
  if (role === "main") {
    // Main owns listen snapshots; keep skin id/name in sync with Appearance.
    await listen<SkinChangedPayload>(SKIN_CHANGED_EVENT, () => {
      void useSkinStore
        .getState()
        .loadSkins()
        .catch((err: unknown) => {
          console.error("Failed to reload skins on main after change:", err);
        });
    });
    await listenSkinPreferencesActions();
    return;
  }

  if (isSkinModeWindow()) {
    await listen<SkinChangedPayload>(SKIN_CHANGED_EVENT, () => {
      void useSkinStore
        .getState()
        .loadSkins()
        .catch((err: unknown) => {
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
