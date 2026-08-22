import { describe, expect, it } from "vitest";
import { FLAT_BAND_GAINS } from "./types";
import { spreadLinearBands } from "./spread";

describe("spreadLinearBands", () => {
  it("matches Nature AdjustAudio between band 1 and band 10", () => {
    const bass = 9;
    const treble = -9;
    const bands = spreadLinearBands(FLAT_BAND_GAINS, [1, 10], 1, bass);
    const withTreble = spreadLinearBands(bands, [1, 10], 10, treble);

    expect(withTreble[0]).toBe(bass);
    expect(withTreble[9]).toBe(treble);
    for (let n = 2; n <= 9; n += 1) {
      const expected = (8 - (n - 2)) * bass + (n - 1) * treble;
      expect(withTreble[n - 1]).toBeCloseTo(expected / 9, 5);
    }
  });

  it("uses the current opposite endpoint when dragging one slider", () => {
    const current = spreadLinearBands(FLAT_BAND_GAINS, [1, 10], 10, 9);
    const next = spreadLinearBands(current, [1, 10], 1, -9);

    expect(next[0]).toBe(-9);
    expect(next[9]).toBe(9);
    expect(next[4]).toBeCloseTo((-9 * 5 + 9 * 4) / 9, 5);
  });

  it("falls back to a single-band write with fewer than two controls", () => {
    const next = spreadLinearBands(FLAT_BAND_GAINS, [1], 1, 6);
    expect(next[0]).toBe(6);
    expect(next.slice(1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
