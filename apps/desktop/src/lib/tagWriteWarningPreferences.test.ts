import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissTagWriteWarning,
  isTagWriteWarningDismissed,
} from "./tagWriteWarningPreferences";

describe("tagWriteWarningPreferences", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is not dismissed by default", () => {
    expect(isTagWriteWarningDismissed()).toBe(false);
  });

  it("stays dismissed once dismissed", () => {
    dismissTagWriteWarning();
    expect(isTagWriteWarningDismissed()).toBe(true);
  });

  it("treats unavailable storage as not dismissed", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(isTagWriteWarningDismissed()).toBe(false);
    expect(() => dismissTagWriteWarning()).not.toThrow();
  });
});
