import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  backgroundsAfterRename,
  genreBackgroundsEqual,
  loadGenreBackgrounds,
  saveGenreBackgrounds,
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

describe("persistence", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    });
  });

  it("round-trips backgrounds", () => {
    saveGenreBackgrounds({ rock: red, jazz: blue });
    expect(loadGenreBackgrounds()).toEqual({ rock: red, jazz: blue });
  });

  it("drops malformed entries and survives corrupt storage", () => {
    storage.set(
      "spiral:genreBackgrounds",
      JSON.stringify({
        ok: red,
        notHex: { start: "red" },
        missing: {},
        nothing: null,
      }),
    );
    expect(loadGenreBackgrounds()).toEqual({ ok: red });

    storage.set("spiral:genreBackgrounds", "{not json");
    expect(loadGenreBackgrounds()).toEqual({});
  });

  it("round-trips a flat theme palette", () => {
    saveGenreBackgrounds({ rock: { theme: "solid" } });
    expect(loadGenreBackgrounds()).toEqual({ rock: { theme: "solid" } });
    expect(genreBackgroundsEqual({ theme: "solid" }, { theme: "solid" })).toBe(
      true,
    );
    expect(genreBackgroundsEqual({ theme: "solid" }, red)).toBe(false);
    expect(genreBackgroundsEqual({ theme: "solid" }, null)).toBe(false);
  });

  it("treats an invalid second color as none", () => {
    storage.set(
      "spiral:genreBackgrounds",
      JSON.stringify({ x: { start: "#123456", end: "nope" } }),
    );
    expect(loadGenreBackgrounds().x).toEqual({ start: "#123456", end: null });
  });
});
