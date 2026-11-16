import { describe, expect, it } from "vitest";
import { formatDurationNatural } from "./format";

describe("formatDurationNatural", () => {
  it("formats hours and minutes", () => {
    expect(formatDurationNatural(4 * 3600 + 15 * 60)).toBe("4h 15m");
  });

  it("drops zero minutes when there are hours", () => {
    expect(formatDurationNatural(3600)).toBe("1h");
  });

  it("formats minutes only", () => {
    expect(formatDurationNatural(42 * 60 + 30)).toBe("42m");
  });

  it("falls back to seconds under a minute", () => {
    expect(formatDurationNatural(45)).toBe("45s");
  });

  it("guards invalid input", () => {
    expect(formatDurationNatural(-1)).toBe("0m");
    expect(formatDurationNatural(Number.NaN)).toBe("0m");
  });
});
