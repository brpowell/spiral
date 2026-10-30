import { create } from "zustand";
import {
  hasCompletedOnboarding,
  markOnboardingCompleted,
} from "../lib/onboardingPreferences";

interface OnboardingState {
  /** True while the onboarding overlay is mounted over the library. */
  open: boolean;
  /** Show onboarding now (first launch, or Developer → Start Onboarding). */
  start: () => void;
  /** Dismiss onboarding and remember that it has been seen. */
  finish: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  open: !hasCompletedOnboarding(),
  start: () => set({ open: true }),
  finish: () => {
    markOnboardingCompleted();
    set({ open: false });
  },
}));
