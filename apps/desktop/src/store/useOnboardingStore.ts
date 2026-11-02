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
  /** Show onboarding now. */
  start: () => void;
  setMusicChoice: (choice: MusicChoice) => void;
  next: () => void;
  back: () => void;
  /** Dismiss onboarding and remember that it has been seen. */
  finish: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  open: !hasCompletedOnboarding(),
  step: 0,
  musicChoice: null,
  start: () => set({ open: true, step: 0, musicChoice: null }),
  setMusicChoice: (musicChoice) => set({ musicChoice }),
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
