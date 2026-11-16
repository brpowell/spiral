import { describe, expect, it } from "vitest";
import { RING_COUNT, ringsGlyph, windUpGlyph } from "./popularityGlyph";

const pointCount = (points: string) => points.split(" ").length;

describe("windUpGlyph", () => {
  it("draws only the faint track when nothing has been played", () => {
    const glyph = windUpGlyph(0);
    expect(glyph.lit).toBeNull();
    expect(glyph.track.length).toBeGreaterThan(0);
  });

  it("shows a short curl for a tiny fraction", () => {
    const glyph = windUpGlyph(0.01);
    expect(glyph.lit).not.toBeNull();
    expect(pointCount(glyph.lit!)).toBeGreaterThan(2);
  });

  it("winds up further as the fraction grows", () => {
    const counts = [0.25, 0.5, 0.75, 1].map((f) =>
      pointCount(windUpGlyph(f).lit!),
    );
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(new Set(counts).size).toBe(counts.length);
  });

  it("fills the whole track at 1 and clamps out-of-range input", () => {
    const full = windUpGlyph(1);
    expect(pointCount(full.lit!)).toBe(pointCount(full.track));
    expect(windUpGlyph(5).lit).toEqual(full.lit);
    expect(windUpGlyph(-1).lit).toBeNull();
  });
});

describe("ringsGlyph", () => {
  const litRings = (fraction: number) =>
    ringsGlyph(fraction).rings.filter((ring) => ring.lit).length;

  it("lights nothing at zero and everything at one", () => {
    expect(litRings(0)).toBe(0);
    expect(litRings(1)).toBe(RING_COUNT);
    expect(ringsGlyph(0).labelLit).toBe(false);
    expect(ringsGlyph(1).labelLit).toBe(true);
  });

  it("lights at least one ring for any listened-to track", () => {
    expect(litRings(0.01)).toBe(1);
  });

  it("lists rings outermost first", () => {
    const radii = ringsGlyph(0.5).rings.map((ring) => ring.radius);
    expect(radii).toEqual([...radii].sort((a, b) => b - a));
  });

  it("lights rings from the outside in", () => {
    expect(ringsGlyph(0.5).rings.map((ring) => ring.lit)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(ringsGlyph(0.01).rings.map((ring) => ring.lit)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("lights the center label only once every groove is lit", () => {
    expect(ringsGlyph(0.7).labelLit).toBe(false);
    expect(ringsGlyph(0.9).labelLit).toBe(true);
  });
});
