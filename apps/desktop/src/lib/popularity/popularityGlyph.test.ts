import { describe, expect, it } from "vitest";
import { RING_COUNT, popularityGlyph } from "./popularityGlyph";

describe("popularityGlyph", () => {
  const litRings = (fraction: number) =>
    popularityGlyph(fraction).rings.filter((ring) => ring.lit).length;

  it("lights nothing at zero and everything at one", () => {
    expect(litRings(0)).toBe(0);
    expect(litRings(1)).toBe(RING_COUNT);
    expect(popularityGlyph(0).labelLit).toBe(false);
    expect(popularityGlyph(1).labelLit).toBe(true);
  });

  it("lights at least one ring for any listened-to track", () => {
    expect(litRings(0.01)).toBe(1);
  });

  it("clamps out-of-range fractions", () => {
    expect(litRings(-1)).toBe(0);
    expect(litRings(5)).toBe(RING_COUNT);
  });

  it("lists rings outermost first", () => {
    const radii = popularityGlyph(0.5).rings.map((ring) => ring.radius);
    expect(radii).toEqual([...radii].sort((a, b) => b - a));
  });

  it("lights rings from the outside in", () => {
    expect(popularityGlyph(0.5).rings.map((ring) => ring.lit)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(popularityGlyph(0.01).rings.map((ring) => ring.lit)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("lights the center label only once every groove is lit", () => {
    expect(popularityGlyph(0.7).labelLit).toBe(false);
    expect(popularityGlyph(0.9).labelLit).toBe(true);
  });
});
