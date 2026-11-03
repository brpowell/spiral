import { create } from "zustand";
import {
  hasCompletedOnboarding,
  markOnboardingCompleted,
} from "../lib/onboardingPreferences";
import { createManagedSource, removeSource } from "../lib/tauri";
import { useSourcesStore } from "./useSourcesStore";

/** How the user answered "Where does your music live?" on the first step. */
export type MusicChoice = "new" | "existing";

export type OnboardingStepId = "library" | "folders" | "style" | "privacy";

/** The welcome steps in order; picking folders only appears for existing music. */
export function onboardingSteps(
  choice: MusicChoice | null,
): readonly OnboardingStepId[] {
  return choice === "existing"
    ? ["library", "folders", "style", "privacy"]
    : ["library", "style", "privacy"];
}

interface OnboardingState {
  /** True while the onboarding overlay is mounted over the library. */
  open: boolean;
  /** Zero-based index of the visible welcome step. */
  step: number;
  /** The first step's answer; null until the user picks one. */
  musicChoice: MusicChoice | null;
  /** Sources added on the folders step this run, which it may remove again. */
  addedSourceIds: readonly number[];
  /** The managed `Tracks` source, when this run created it. */
  managedSourceId: number | null;
  /** Show onboarding now. */
  start: () => void;
  setMusicChoice: (choice: MusicChoice) => void;
  /**
   * Act on the first step's answer before moving on: "new" has Spiral manage
   * a `Tracks` folder; "existing" undoes one this run made, so only the
   * folders the user picks become sources.
   */
  applyMusicChoice: () => Promise<void>;
  noteSourceAdded: (id: number) => void;
  noteSourceRemoved: (id: number) => void;
  next: () => void;
  back: () => void;
  /** Dismiss onboarding and remember that it has been seen. */
  finish: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  open: !hasCompletedOnboarding(),
  step: 0,
  musicChoice: null,
  addedSourceIds: [],
  managedSourceId: null,
  start: () =>
    set({
      open: true,
      step: 0,
      musicChoice: null,
      addedSourceIds: [],
      managedSourceId: null,
    }),
  setMusicChoice: (musicChoice) => set({ musicChoice }),
  applyMusicChoice: async () => {
    const { musicChoice, managedSourceId } = get();
    const sources = useSourcesStore.getState();
    if (musicChoice === "new") {
      if (managedSourceId != null) return;
      await sources.loadSources();
      const existed = new Set(
        useSourcesStore.getState().sources.map((source) => source.id),
      );
      const source = await createManagedSource();
      sources.applySource(source);
      if (!existed.has(source.id)) set({ managedSourceId: source.id });
    } else if (musicChoice === "existing" && managedSourceId != null) {
      await removeSource(managedSourceId);
      set({ managedSourceId: null });
      await sources.loadSources();
    }
  },
  noteSourceAdded: (id) =>
    set((s) => ({ addedSourceIds: [...s.addedSourceIds, id] })),
  noteSourceRemoved: (id) =>
    set((s) => ({ addedSourceIds: s.addedSourceIds.filter((x) => x !== id) })),
  next: () =>
    set((s) => ({
      step: Math.min(s.step + 1, onboardingSteps(s.musicChoice).length - 1),
    })),
  back: () => set((s) => ({ step: Math.max(s.step - 1, 0) })),
  finish: () => {
    markOnboardingCompleted();
    set({ open: false });
  },
}));
