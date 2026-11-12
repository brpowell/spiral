import { describe, expect, it } from "vitest";
import { cubicBezierEasing } from "./motion";

describe("cubicBezierEasing", () => {
  it("clamps to the endpoints", () => {
    const ease = cubicBezierEasing(0.22, 1, 0.36, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
  });

  it("matches a linear curve exactly", () => {
    const linear = cubicBezierEasing(0, 0, 1, 1);
    expect(linear(0.25)).toBeCloseTo(0.25, 5);
    expect(linear(0.5)).toBeCloseTo(0.5, 5);
    expect(linear(0.75)).toBeCloseTo(0.75, 5);
  });

  it("front-loads motion for an ease-out curve, unlike a linear fallback", () => {
    // The onboarding dock curve: fast out of the gate, settling at the end.
    const ease = cubicBezierEasing(0.22, 1, 0.36, 1);
    // A linear curve would read 0.3 here; an ease-out curve reads well above it.
    expect(ease(0.3)).toBeGreaterThan(0.5);
  });
});
