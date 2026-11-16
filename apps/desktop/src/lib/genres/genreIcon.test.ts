import { describe, expect, it } from "vitest";
import { defaultIconForGenre } from "./genreIcon";

describe("defaultIconForGenre", () => {
  it("is stable for a genre", () => {
    expect(defaultIconForGenre("rock")).toBe(defaultIconForGenre("rock"));
  });

  it("returns a real icon id and spreads genres over several icons", () => {
    const keys = [
      "rock",
      "jazz",
      "pop",
      "metal",
      "folk",
      "lo-fi",
      "soul",
      "punk",
    ];
    const icons = new Set(keys.map(defaultIconForGenre));
    expect(icons.size).toBeGreaterThan(2);
    for (const icon of icons) expect(icon).toMatch(/^[a-zA-Z0-9]+$/);
  });
});
