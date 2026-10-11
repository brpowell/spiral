import { describe, expect, it } from "vitest";
import {
  BackgroundTaskCancelledError,
  isBackgroundTaskCancelledError,
} from "./backgroundTaskCancel";

describe("BackgroundTaskCancelledError", () => {
  it("carries a toast label and is detected by the type guard", () => {
    const err = new BackgroundTaskCancelledError("Lyrics fetch cancelled");
    expect(err.toastLabel).toBe("Lyrics fetch cancelled");
    expect(err.dismissMs).toBeUndefined();
    expect(isBackgroundTaskCancelledError(err)).toBe(true);
    expect(isBackgroundTaskCancelledError(new Error("cancelled"))).toBe(false);
  });

  it("can carry a sticky dismissMs", () => {
    const err = new BackgroundTaskCancelledError("Cancelled", {
      dismissMs: null,
    });
    expect(err.dismissMs).toBeNull();
  });

  it("defaults the toast label from catalogs", () => {
    expect(new BackgroundTaskCancelledError().toastLabel).toBe("Cancelled");
  });
});
