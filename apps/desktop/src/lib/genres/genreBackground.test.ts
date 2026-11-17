import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  backgroundsAfterRename,
  genreBackgroundsEqual,
  clearLegacyGenreBackgrounds,
  fromBackgroundRecord,
  readLegacyGenreBackgrounds,
  toBackgroundRecord,
  type GenreBackground,
} from "./genreBackground";

const red: GenreBackground = { start: "#ff0000", end: null };
const blue: GenreBackground = { start: "#0000ff", end: "#000044" };

describe("genreBackgroundsEqual", () => {
  it("compares both stops and treats null as no background", () => {
    expect(genreBackgroundsEqual(red, { ...red })).toBe(true);
    expect(genreBackgroundsEqual(red, { ...red, end: "#111111" })).toBe(false);
    expect(genreBackgroundsEqual(null, undefined)).toBe(true);
    expect(genreBackgroundsEqual(red, null)).toBe(false);
  });
});

describe("backgroundsAfterRename", () => {
  it("moves a background to the new key", () => {
    expect(backgroundsAfterRename({ rock: red }, "rock", "metal")).toEqual({
      metal: red,
    });
  });

  it("keeps the destination's own background when merging", () => {
    expect(
      backgroundsAfterRename({ rock: red, metal: blue }, "rock", "metal"),
    ).toEqual({ metal: blue });
  });

  it("is a no-op when the key is unchanged or has no background", () => {
    const backgrounds = { rock: red };
    expect(backgroundsAfterRename(backgrounds, "rock", "rock")).toBe(
      backgrounds,
    );
    expect(backgroundsAfterRename(backgrounds, "jazz", "blues")).toBe(
      backgrounds,
    );
  });
});

describe("legacy local storage", () => {
  const storage = new Map<string, string>();
  const KEY = "spiral:genreBackgrounds";

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => void storage.delete(key),
    });
  });

  it("reads backgrounds an earlier version saved", () => {
    storage.set(
      KEY,
      JSON.stringify({ rock: red, jazz: blue, flat: { theme: "solid" } }),
    );
    expect(readLegacyGenreBackgrounds()).toEqual({
      rock: red,
      jazz: blue,
      flat: { theme: "solid" },
    });
  });

  it("drops malformed entries and survives corrupt storage", () => {
    storage.set(
      KEY,
      JSON.stringify({
        ok: red,
        notHex: { start: "red" },
        missing: {},
        nothing: null,
      }),
    );
    expect(readLegacyGenreBackgrounds()).toEqual({ ok: red });

    storage.set(KEY, "{not json");
    expect(readLegacyGenreBackgrounds()).toEqual({});
  });

  it("treats an invalid second color as none", () => {
    storage.set(KEY, JSON.stringify({ x: { start: "#123456", end: "nope" } }));
    expect(readLegacyGenreBackgrounds().x).toEqual({
      start: "#123456",
      end: null,
    });
  });

  it("clears the stored copy", () => {
    storage.set(KEY, JSON.stringify({ rock: red }));
    clearLegacyGenreBackgrounds();
    expect(storage.has(KEY)).toBe(false);
  });
});

describe("background records", () => {
  it("round-trips a color, a gradient and the flat theme", () => {
    for (const background of [red, blue, { theme: "solid" } as const]) {
      expect(fromBackgroundRecord(toBackgroundRecord(background))).toEqual(
        background,
      );
    }
    expect(toBackgroundRecord(null)).toBeNull();
    expect(fromBackgroundRecord(null)).toBeNull();
  });

  it("ignores a color record without a valid start", () => {
    expect(
      fromBackgroundRecord({ kind: "color", start: null, end: null }),
    ).toBeNull();
  });
});
