import { create } from "zustand";
import { afterUiTransition } from "../lib/scheduling";
import type {
  ImportDuplicateContext,
  ImportDedupeResolution,
} from "../lib/trackDedupe";

interface ImportDedupePromptRequest {
  context: ImportDuplicateContext;
  resolve: (resolution: ImportDedupeResolution) => void;
  reject: (reason?: unknown) => void;
}

interface ImportDedupeState {
  prompt: ImportDedupePromptRequest | null;
  batchRule: ImportDedupeResolution | null;
  resetImportDedupeSession: () => void;
  promptImportDedupe: (
    context: ImportDuplicateContext,
  ) => Promise<ImportDedupeResolution>;
  resolveImportDedupe: (
    resolution: ImportDedupeResolution,
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
      return Promise.resolve(applyBatchRule(batchRule, context));
    }

    return new Promise<ImportDedupeResolution>((resolve, reject) => {
      set({ prompt: { context, resolve, reject } });
    });
  },

  resolveImportDedupe: async (resolution, applyToRemaining) => {
    const prompt = get().prompt;
    if (!prompt) return;

    set({
      prompt: null,
      batchRule:
        applyToRemaining && resolution.action !== "import"
          ? resolution
          : get().batchRule,
    });

    await afterUiTransition();
    prompt.resolve(resolution);
  },

  rejectImportDedupe: () => {
    const prompt = get().prompt;
    if (!prompt) return;
    prompt.reject(new ImportCancelledError());
    set({ prompt: null });
  },
}));

/** Apply a batch rule to the current prompt, scoping lyrics preference to conflicts. */
export function applyBatchRule(
  batchRule: ImportDedupeResolution,
  context: ImportDuplicateContext,
): ImportDedupeResolution {
  if (batchRule.action === "replace" && context.hasLyricsConflict) {
    return {
      action: "replace",
      replaceLyrics: batchRule.replaceLyrics ?? false,
    };
  }
  return { action: batchRule.action };
}

export class ImportCancelledError extends Error {
  constructor() {
    super("Import cancelled");
    this.name = "ImportCancelledError";
  }
}

export function isImportCancelledError(err: unknown): boolean {
  return err instanceof ImportCancelledError;
}
