import { describe, expect, it } from "vitest";
import {
  defaultSkinUserPreferences,
  soundEffectsEnabledFromPreferences,
  toggledSoundEffectsPreferences,
} from "../types/skinPreferences";

describe("skinPreferences", () => {
  it("defaults sound effects to enabled when absent", () => {
    expect(
      soundEffectsEnabledFromPreferences(defaultSkinUserPreferences()),
    ).toBe(true);
  });

  it("respects explicit soundEffectsEnabled false", () => {
    expect(
      soundEffectsEnabledFromPreferences({
        builtin: { soundEffectsEnabled: false },
      }),
    ).toBe(false);
  });

  it("respects explicit soundEffectsEnabled true", () => {
    expect(
      soundEffectsEnabledFromPreferences({
        builtin: { soundEffectsEnabled: true },
      }),
    ).toBe(true);
  });

  it("flips default-on to explicit off", () => {
    expect(
      soundEffectsEnabledFromPreferences(
        toggledSoundEffectsPreferences(defaultSkinUserPreferences()),
      ),
    ).toBe(false);
  });
});
