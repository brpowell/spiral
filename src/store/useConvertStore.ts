import { create } from "zustand";
import { afterUiTransition } from "../lib/scheduling";
import type { ConvertMode } from "../lib/convertTracks";

interface ConvertConfirmResult {
  profileId: string;
  mode: ConvertMode;
}

interface ConvertPromptRequest {
  trackIds: number[];
  resolve: (result: ConvertConfirmResult) => void;
  reject: () => void;
}

interface ConvertState {
  prompt: ConvertPromptRequest | null;
  promptConvert: (trackIds: number[]) => Promise<ConvertConfirmResult | null>;
  confirmConvert: (result: ConvertConfirmResult) => Promise<void>;
  cancelConvert: () => void;
}

export const useConvertStore = create<ConvertState>((set, get) => ({
  prompt: null,

  promptConvert: (trackIds) => {
    const uniqueIds = [...new Set(trackIds)];
    if (uniqueIds.length === 0) {
      return Promise.resolve(null);
    }

    return new Promise<ConvertConfirmResult | null>((resolve) => {
      set({
        prompt: {
          trackIds: uniqueIds,
          resolve: (result) => resolve(result),
          reject: () => resolve(null),
        },
      });
    });
  },

  confirmConvert: async (result) => {
    const prompt = get().prompt;
    if (!prompt) return;

    set({ prompt: null });
    await afterUiTransition();
    prompt.resolve(result);
  },

  cancelConvert: () => {
    const prompt = get().prompt;
    if (!prompt) return;
    prompt.reject();
    set({ prompt: null });
  },
}));
