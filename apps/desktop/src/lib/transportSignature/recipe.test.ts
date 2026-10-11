import { describe, expect, it } from "vitest";
import {
  formatPitch,
  formatSemitones,
  frequencyForAction,
  MUSICAL_INTERVALS,
  parseRecipe,
  recipeExport,
  SPIRAL_PRESET,
} from "./recipe";

describe("transport signature recipe", () => {
  it("parses the spiral preset and clamps runaway gain", () => {
    const parsed = parseRecipe({ ...SPIRAL_PRESET.recipe, masterGain: 9 });
    expect(parsed?.name).toBe("Spiral");
    expect(parsed?.masterGain).toBe(0.8);
    expect(parsed?.body.startHz).toBeCloseTo(SPIRAL_PRESET.recipe.body.startHz);
  });

  it("rejects a disabled or unknown file", () => {
    expect(parseRecipe({ enabled: false, version: 1 })).toBeNull();
    expect(parseRecipe({ version: 2, name: "Future" })).toBeNull();
    expect(parseRecipe(null)).toBeNull();
  });

  it("round-trips an exported recipe", () => {
    const file = recipeExport(SPIRAL_PRESET.recipe);
    expect(file.enabled).toBe(true);
    expect(parseRecipe(file)?.name).toBe("Spiral");
  });

  it("shifts pitch by semitones and formats notes", () => {
    expect(frequencyForAction(440, 12)).toBeCloseTo(880);
    expect(frequencyForAction(440, 0)).toBeCloseTo(440);
    expect(formatPitch(440)).toBe("440 Hz · A4");
    expect(formatSemitones(0)).toBe("0");
    expect(formatSemitones(3)).toBe("+3");
    expect(formatSemitones(-2)).toBe("-2");
    expect(MUSICAL_INTERVALS.fifth).toBeCloseTo(1.4983, 3);
    expect(MUSICAL_INTERVALS.octave).toBe(2);
  });
});
