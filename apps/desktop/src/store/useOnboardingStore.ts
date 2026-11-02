import { create } from "zustand";
import {
  hasCompletedOnboarding,
  markOnboardingCompleted,
} from "../lib/onboardingPreferences";

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
  /** Show onboarding now. */
  start: () => void;
  setMusicChoice: (choice: MusicChoice) => void;
  noteSourceAdded: (id: number) => void;
  noteSourceRemoved: (id: number) => void;
  next: () => void;
  back: () => void;
  /** Dismiss onboarding and remember that it has been seen. */
  finish: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  open: !hasCompletedOnboarding(),
  step: 0,
  musicChoice: null,
  addedSourceIds: [],
  start: () =>
    set({ open: true, step: 0, musicChoice: null, addedSourceIds: [] }),
  setMusicChoice: (musicChoice) => set({ musicChoice }),
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
