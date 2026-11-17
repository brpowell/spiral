import { describe, expect, it } from "vitest";
import {
  backgroundsAfterRename,
  genreBackgroundsEqual,
  fromBackgroundRecord,
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
