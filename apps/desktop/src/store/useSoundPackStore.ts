import { create } from "zustand";
import { broadcastSoundPackChanged } from "../lib/packSounds";
import {
  getActiveSoundPackId,
  listSoundPacks,
  saveActiveSoundPackId,
} from "../lib/tauri";
import type { SoundPackSummary } from "../types/soundPack";

export const DEFAULT_SOUND_PACK_ID = "spiral.sound.default";

interface SoundPackState {
  soundPacks: SoundPackSummary[];
  activeSoundPackId: string;
  soundPacksLoaded: boolean;
  loadSoundPacks: () => Promise<void>;
  setActiveSoundPack: (soundPackId: string) => Promise<void>;
}

export const useSoundPackStore = create<SoundPackState>((set) => ({
  soundPacks: [],
  activeSoundPackId: DEFAULT_SOUND_PACK_ID,
  soundPacksLoaded: false,

  loadSoundPacks: async () => {
    const [soundPacks, activeSoundPackId] = await Promise.all([
      listSoundPacks(),
      getActiveSoundPackId(),
    ]);
    set({ soundPacks, activeSoundPackId, soundPacksLoaded: true });
  },

  setActiveSoundPack: async (soundPackId) => {
    await saveActiveSoundPackId(soundPackId);
    set({ activeSoundPackId: soundPackId });
    await broadcastSoundPackChanged();
  },
}));
