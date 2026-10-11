import { create } from "zustand";
import { emit } from "@tauri-apps/api/event";
import {
  SKIN_PREFERENCES_CHANGED_EVENT,
  type SkinPreferencesChangedPayload,
} from "../lib/skinBridge";
import { getSkinPreferences, saveSkinPreferences } from "../lib/tauri";
import {
  evaluateAuthorSkinPref,
  findSkinSetting,
  setBooleanCustomPref,
  toggledBooleanCustomPref,
} from "../lib/skinPrefSettings";
import { useSkinStore } from "./useSkinStore";
import {
  defaultSkinUserPreferences,
  toggledSoundEffectsPreferences,
  type SkinUserPreferences,
} from "../types/skinPreferences";

interface SkinPreferencesState {
  skinId: string | null;
  preferences: SkinUserPreferences;
  loadForSkin: (skinId: string) => Promise<void>;
  toggleSoundEffects: (explicitSkinId?: string) => Promise<void>;
  togglePref: (settingId: string, explicitSkinId?: string) => Promise<void>;
  setPref: (
    settingId: string,
    value: unknown,
    explicitSkinId?: string,
  ) => Promise<void>;
}

async function persistPreferences(
  skinId: string,
  preferences: SkinUserPreferences,
  previous: SkinUserPreferences,
  set: (partial: Partial<SkinPreferencesState>) => void,
): Promise<void> {
  set({ skinId, preferences });
  try {
    await saveSkinPreferences(skinId, preferences);
    await emit(SKIN_PREFERENCES_CHANGED_EVENT, {
      skinId,
      preferences,
    } satisfies SkinPreferencesChangedPayload);
  } catch (err) {
    console.error("Failed to save skin preferences:", err);
    set({ preferences: previous });
  }
}

export const useSkinPreferencesStore = create<SkinPreferencesState>(
  (set, get) => ({
    skinId: null,
    preferences: defaultSkinUserPreferences(),

    loadForSkin: async (skinId) => {
      try {
        const preferences = await getSkinPreferences(skinId);
        set({ skinId, preferences });
      } catch (err) {
        console.error("Failed to load skin preferences:", err);
        set({
          skinId,
          preferences: defaultSkinUserPreferences(),
        });
      }
    },

    toggleSoundEffects: async (explicitSkinId) => {
      const { skinId: storedSkinId, preferences } = get();
      const skinId = storedSkinId ?? explicitSkinId;
      if (!skinId) return;

      const next = toggledSoundEffectsPreferences(preferences);
      await persistPreferences(skinId, next, preferences, set);
    },

    togglePref: async (settingId, explicitSkinId) => {
      const { skinId: storedSkinId, preferences } = get();
      const skinId = storedSkinId ?? explicitSkinId;
      if (!skinId) return;

      const settings = useSkinStore.getState().activePack?.manifest.settings;
      const setting = findSkinSetting(settings, settingId);
      if (!setting || setting.type !== "boolean") return;

      const current =
        evaluateAuthorSkinPref(settingId, settings, preferences) ?? false;
      const next = toggledBooleanCustomPref(preferences, settingId, current);
      await persistPreferences(skinId, next, preferences, set);
    },

    setPref: async (settingId, value, explicitSkinId) => {
      const { skinId: storedSkinId, preferences } = get();
      const skinId = storedSkinId ?? explicitSkinId;
      if (!skinId) return;

      const settings = useSkinStore.getState().activePack?.manifest.settings;
      const setting = findSkinSetting(settings, settingId);
      if (!setting || setting.type !== "boolean" || typeof value !== "boolean") {
        return;
      }

      const next = setBooleanCustomPref(preferences, settingId, value);
      await persistPreferences(skinId, next, preferences, set);
    },
  }),
);
