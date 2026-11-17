import { describe, expect, it } from "vitest";
import { genreLabelSize } from "./genreLabel";

describe("genreLabelSize", () => {
  it("is biggest for short names, capped", () => {
    expect(genreLabelSize("Rock")).toBe(11);
    expect(genreLabelSize("Pop")).toBe(11);
  });

  it("shrinks as the longest word grows", () => {
    expect(genreLabelSize("Contemporary R&B")).toBeLessThan(
      genreLabelSize("Metal"),
    );
    expect(genreLabelSize("Extraordinarily")).toBeLessThan(
      genreLabelSize("Contemporary R&B"),
    );
  });

  it("sizes by the longest piece, so wrapping words do not shrink it", () => {
    expect(genreLabelSize("Hard Rock")).toBe(genreLabelSize("Hard"));
    expect(genreLabelSize("Lo-fi")).toBe(11);
  });

  it("never goes below the minimum, even for a very long word", () => {
    expect(genreLabelSize("Supercalifragilisticexpialidocious")).toBe(7);
    expect(genreLabelSize("")).toBe(11);
  });
});
