const STORAGE_KEY = "spiral:onboardingCompleted";

/** Whether the first-run onboarding has already played on this install. */
export function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    /* ignore private mode / blocked storage: treat as not completed */
    return false;
  }
}

export function markOnboardingCompleted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore quota / private mode */
  }
}

/** DEV helper: forget completion so the next launch shows onboarding again. */
export function resetOnboardingCompleted(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
