import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyTagWriteDismissals,
  loadTagWriteDismissals,
  saveTagWriteDismissals,
} from "./tagWriteConfirmPreferences";

describe("tagWriteConfirmPreferences", () => {
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

  it("defaults to nothing dismissed", () => {
    expect(loadTagWriteDismissals()).toEqual(emptyTagWriteDismissals());
  });

  it("round-trips dismissals", () => {
    saveTagWriteDismissals({
      track: true,
      album: true,
      artist: false,
    });
    expect(loadTagWriteDismissals()).toEqual({
      track: true,
      album: true,
      artist: false,
    });
  });

  it("ignores corrupt or non-boolean stored values", () => {
    storage.set("spiral:tagWriteConfirmDismissed", "{not json");
    expect(loadTagWriteDismissals()).toEqual(emptyTagWriteDismissals());

    storage.set(
      "spiral:tagWriteConfirmDismissed",
      JSON.stringify({ track: "yes", album: true }),
    );
    expect(loadTagWriteDismissals()).toEqual({
      ...emptyTagWriteDismissals(),
      album: true,
    });
  });
});
