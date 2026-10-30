import { create } from "zustand";
import {
  hasCompletedOnboarding,
  markOnboardingCompleted,
} from "../lib/onboardingPreferences";

export const ONBOARDING_STEP_COUNT = 3;

interface OnboardingState {
  /** True while the onboarding overlay is mounted over the library. */
  open: boolean;
  /** Zero-based index of the visible welcome step. */
  step: number;
  /** Show onboarding now (first launch, or Developer → Start Onboarding). */
  start: () => void;
  next: () => void;
  back: () => void;
  /** Dismiss onboarding and remember that it has been seen. */
  finish: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  open: !hasCompletedOnboarding(),
  step: 0,
  start: () => set({ open: true, step: 0 }),
  next: () =>
    set((s) => ({ step: Math.min(s.step + 1, ONBOARDING_STEP_COUNT - 1) })),
  back: () => set((s) => ({ step: Math.max(s.step - 1, 0) })),
  finish: () => {
    markOnboardingCompleted();
    set({ open: false });
  },
}));
