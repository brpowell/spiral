import { create } from "zustand";
import { emit } from "@tauri-apps/api/event";
import {
  SKIN_PREFERENCES_CHANGED_EVENT,
  type SkinPreferencesChangedPayload,
} from "../lib/skinBridge";
import {
  getSkinPreferences,
  saveSkinPreferences,
} from "../lib/tauri";
import {
  defaultSkinUserPreferences,
  soundEffectsEnabledFromPreferences,
  type SkinUserPreferences,
} from "../types/skinPreferences";

interface SkinPreferencesState {
  skinId: string | null;
  preferences: SkinUserPreferences;
  loadForSkin: (skinId: string) => Promise<void>;
  toggleSoundEffects: () => Promise<void>;
}

export const useSkinPreferencesStore = create<SkinPreferencesState>((set, get) => ({
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

  toggleSoundEffects: async () => {
    const { skinId, preferences } = get();
    if (!skinId) return;

    const next: SkinUserPreferences = {
      ...preferences,
      builtin: {
        ...preferences.builtin,
        soundEffectsEnabled: !soundEffectsEnabledFromPreferences(preferences),
      },
    };

    set({ preferences: next });
    try {
      await saveSkinPreferences(skinId, next);
      await emit(SKIN_PREFERENCES_CHANGED_EVENT, {
        skinId,
      } satisfies SkinPreferencesChangedPayload);
    } catch (err) {
      console.error("Failed to save skin preferences:", err);
      set({ preferences });
    }
  },
}));
