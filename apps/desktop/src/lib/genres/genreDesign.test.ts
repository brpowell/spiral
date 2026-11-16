import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultDesignForGenre,
  designsAfterApplyToAll,
  designsAfterRename,
  genreDesignsEqual,
  loadGenreDesigns,
  saveGenreDesigns,
  type GenreDesign,
} from "./genreDesign";

const red: GenreDesign = {
  mode: "design",
  background: "#ff0000",
  backgroundEnd: null,
  icon: "note",
};
const blue: GenreDesign = {
  mode: "design",
  background: "#0000ff",
  backgroundEnd: "#000044",
  icon: "note",
};

describe("genreDesignsEqual", () => {
  it("compares every field and treats null/undefined as no design", () => {
    expect(genreDesignsEqual(red, { ...red })).toBe(true);
    expect(genreDesignsEqual(red, { ...red, backgroundEnd: "#111111" })).toBe(
      false,
    );
    expect(genreDesignsEqual(null, undefined)).toBe(true);
    expect(genreDesignsEqual(red, null)).toBe(false);
  });
});

describe("designsAfterRename", () => {
  it("moves a design to the new key", () => {
    expect(designsAfterRename({ rock: red }, "rock", "metal")).toEqual({
      metal: red,
    });
  });

  it("keeps the destination's design when merging into a genre that has one", () => {
    expect(
      designsAfterRename({ rock: red, metal: blue }, "rock", "metal"),
    ).toEqual({ metal: blue });
  });

  it("is a no-op when the key is unchanged or has no design", () => {
    const designs = { rock: red };
    expect(designsAfterRename(designs, "rock", "rock")).toBe(designs);
    expect(designsAfterRename(designs, "jazz", "blues")).toBe(designs);
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

  it("round-trips designs", () => {
    saveGenreDesigns({ rock: red, jazz: blue });
    expect(loadGenreDesigns()).toEqual({ rock: red, jazz: blue });
  });

  it("drops malformed entries and survives corrupt storage", () => {
    storage.set(
      "spiral:genreDesigns",
      JSON.stringify({ ok: red, bad: { background: 3 }, worse: null }),
    );
    expect(loadGenreDesigns()).toEqual({ ok: red });

    storage.set("spiral:genreDesigns", "{not json");
    expect(loadGenreDesigns()).toEqual({});
  });

  it("falls back to the default icon for an unknown icon id", () => {
    storage.set(
      "spiral:genreDesigns",
      JSON.stringify({ x: { background: "#123456", icon: "no-such-icon" } }),
    );
    expect(loadGenreDesigns().x.icon).toBe("note");
  });
});

describe("defaultDesignForGenre", () => {
  it("is stable for a genre and a valid gradient design", () => {
    const design = defaultDesignForGenre("rock");
    expect(defaultDesignForGenre("rock")).toEqual(design);
    expect(design.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(design.backgroundEnd).toMatch(/^#[0-9a-f]{6}$/);
    expect(design.icon).toBeTruthy();
  });

  it("gives different genres different looks", () => {
    const keys = ["rock", "jazz", "pop", "metal", "folk", "lo-fi", "soul"];
    const looks = new Set(
      keys.map((key) => defaultDesignForGenre(key).background),
    );
    expect(looks.size).toBeGreaterThan(keys.length - 2);
  });
});

describe("art mode", () => {
  it("differs by mode even when the colors match", () => {
    expect(genreDesignsEqual(red, { ...red, mode: "album" })).toBe(false);
  });

  it("round-trips the album mode and defaults old entries to design", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    });
    storage.set(
      "spiral:genreDesigns",
      JSON.stringify({
        picked: { ...red, mode: "album" },
        legacy: { background: "#123456", icon: "note" },
      }),
    );
    const loaded = loadGenreDesigns();
    expect(loaded.picked.mode).toBe("album");
    expect(loaded.legacy.mode).toBe("design");
  });
});

describe("designsAfterApplyToAll", () => {
  it("gives every listed genre the design and leaves the rest alone", () => {
    const designs = { rock: red, other: blue };
    const next = designsAfterApplyToAll(designs, ["rock", "jazz", "pop"], blue);
    expect(next).toEqual({ rock: blue, jazz: blue, pop: blue, other: blue });
    expect(designs).toEqual({ rock: red, other: blue });
  });

  it("clears the listed genres when the design is null", () => {
    const next = designsAfterApplyToAll(
      { rock: red, jazz: blue, other: red },
      ["rock", "jazz", "pop"],
      null,
    );
    expect(next).toEqual({ other: red });
  });
});
