import { create } from "zustand";
import { afterUiTransition } from "../lib/scheduling";
import type {
  ImportDuplicateContext,
  ImportDedupeAction,
} from "../lib/trackDedupe";

interface ImportDedupePromptRequest {
  context: ImportDuplicateContext;
  resolve: (action: ImportDedupeAction) => void;
  reject: (reason?: unknown) => void;
}

interface ImportDedupeState {
  prompt: ImportDedupePromptRequest | null;
  batchRule: ImportDedupeAction | null;
  resetImportDedupeSession: () => void;
  promptImportDedupe: (
    context: ImportDuplicateContext,
  ) => Promise<ImportDedupeAction>;
  resolveImportDedupe: (
    action: ImportDedupeAction,
    applyToRemaining: boolean,
  ) => Promise<void>;
  rejectImportDedupe: () => void;
}

export const useImportDedupeStore = create<ImportDedupeState>((set, get) => ({
  prompt: null,
  batchRule: null,

  resetImportDedupeSession: () => {
    set({ prompt: null, batchRule: null });
  },

  promptImportDedupe: (context) => {
    const batchRule = get().batchRule;
    if (batchRule != null) {
      return Promise.resolve(batchRule);
    }

    return new Promise<ImportDedupeAction>((resolve, reject) => {
      set({ prompt: { context, resolve, reject } });
    });
  },

  resolveImportDedupe: async (action, applyToRemaining) => {
    const prompt = get().prompt;
    if (!prompt) return;

    set({
      prompt: null,
      batchRule:
        applyToRemaining && action !== "import" ? action : get().batchRule,
    });

    await afterUiTransition();
    prompt.resolve(action);
  },

  rejectImportDedupe: () => {
    const prompt = get().prompt;
    if (!prompt) return;
    prompt.reject(new ImportCancelledError());
    set({ prompt: null });
  },
}));

export class ImportCancelledError extends Error {
  constructor() {
    super("Import cancelled");
    this.name = "ImportCancelledError";
  }
}

export function isImportCancelledError(err: unknown): boolean {
  return err instanceof ImportCancelledError;
}
