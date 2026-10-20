const STORAGE_KEY = "spiral:tagWriteWarningDismissed";

export function isTagWriteWarningDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    /* ignore quota / private mode */
    return false;
  }
}

export function dismissTagWriteWarning(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}
