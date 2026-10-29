import { create } from "zustand";
import { afterUiTransition } from "../lib/scheduling";
import {
  emptyTagWriteDismissals,
  loadTagWriteDismissals,
  saveTagWriteDismissals,
  type TagWriteContext,
  type TagWriteDismissals,
} from "../lib/tagWriteConfirmPreferences";

export interface TagWritePrompt {
  context: TagWriteContext;
  fileCount: number;
  resolve: (confirmed: boolean) => void;
}

interface TagWriteConfirmState {
  dismissed: TagWriteDismissals;
  prompt: TagWritePrompt | null;
  /**
   * Resolves true when the save may proceed: immediately if the user already
   * dismissed this context's warning, otherwise after they confirm the dialog.
   */
  confirmTagWrite: (
    context: TagWriteContext,
    fileCount: number,
  ) => Promise<boolean>;
  answerPrompt: (confirmed: boolean, dontAskAgain: boolean) => Promise<void>;
  /** Remember "don't ask again" for a context confirmed outside the dialog. */
  dismissContext: (context: TagWriteContext) => void;
  resetDismissals: () => void;
}

export const useTagWriteConfirmStore = create<TagWriteConfirmState>(
  (set, get) => ({
    dismissed: loadTagWriteDismissals(),
    prompt: null,

    confirmTagWrite: (context, fileCount) => {
      if (get().dismissed[context]) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        get().prompt?.resolve(false);
        set({ prompt: { context, fileCount, resolve } });
      });
    },

    answerPrompt: async (confirmed, dontAskAgain) => {
      const prompt = get().prompt;
      if (!prompt) return;

      if (confirmed && dontAskAgain) {
        const dismissed = { ...get().dismissed, [prompt.context]: true };
        saveTagWriteDismissals(dismissed);
        set({ dismissed, prompt: null });
      } else {
        set({ prompt: null });
      }

      // Let the dialog finish closing before the save starts its own UI work.
      if (confirmed) await afterUiTransition();
      prompt.resolve(confirmed);
    },

    dismissContext: (context) => {
      const dismissed = { ...get().dismissed, [context]: true };
      saveTagWriteDismissals(dismissed);
      set({ dismissed });
    },

    resetDismissals: () => {
      const dismissed = emptyTagWriteDismissals();
      saveTagWriteDismissals(dismissed);
      set({ dismissed });
    },
  }),
);
