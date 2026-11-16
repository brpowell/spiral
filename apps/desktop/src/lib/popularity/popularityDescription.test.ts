import { describe, expect, it } from "vitest";
import { popularityDescription } from "./popularityDescription";

describe("popularityDescription", () => {
  it("summarizes the score to one decimal and explains where it comes from", () => {
    const { summary, explainer } = popularityDescription(12.43);
    expect(summary).toBe("Popularity: 12.4");
    expect(explainer).toContain("your own private listening");
  });

  it("says the track hasn't been played when there is no score", () => {
    expect(popularityDescription(0).summary).toBe("Not played yet");
  });

  it("shows tiny scores as <0.1 instead of 0.0", () => {
    expect(popularityDescription(0.03).summary).toBe("Popularity: <0.1");
  });

  it("says recent plays count most", () => {
    expect(popularityDescription(5).explainer).toContain("recent plays");
  });
});
