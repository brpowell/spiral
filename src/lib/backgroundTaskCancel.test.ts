import { describe, expect, it } from "vitest";
import {
  BackgroundTaskCancelledError,
  isBackgroundTaskCancelledError,
} from "./backgroundTaskCancel";

describe("BackgroundTaskCancelledError", () => {
  it("carries a toast label and is detected by the type guard", () => {
    const err = new BackgroundTaskCancelledError("Lyrics fetch cancelled");
    expect(err.toastLabel).toBe("Lyrics fetch cancelled");
    expect(isBackgroundTaskCancelledError(err)).toBe(true);
    expect(isBackgroundTaskCancelledError(new Error("cancelled"))).toBe(false);
  });
});
