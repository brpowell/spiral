import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadArtistBrowseMode,
  saveArtistBrowseMode,
} from "./artistBrowsePreferences";

describe("artistBrowsePreferences", () => {
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

  it("defaults to discography", () => {
    expect(loadArtistBrowseMode()).toBe("discography");
  });

  it("round-trips saved mode", () => {
    saveArtistBrowseMode("performers");
    expect(loadArtistBrowseMode()).toBe("performers");
  });

  it("ignores invalid stored values", () => {
    storage.set("spiral:artistBrowseMode", "invalid");
    expect(loadArtistBrowseMode()).toBe("discography");
  });
});
