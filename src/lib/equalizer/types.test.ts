import { describe, expect, it } from "vitest";
import {
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  gainDbToRatio,
  ratioToGainDb,
} from "./types";

describe("gainDbToRatio / ratioToGainDb", () => {
  it("maps endpoints", () => {
    expect(gainDbToRatio(EQ_GAIN_MIN)).toBe(0);
    expect(gainDbToRatio(EQ_GAIN_MAX)).toBe(1);
    expect(ratioToGainDb(0)).toBe(EQ_GAIN_MIN);
    expect(ratioToGainDb(1)).toBe(EQ_GAIN_MAX);
  });

  it("maps center to flat", () => {
    expect(gainDbToRatio(0)).toBe(0.5);
    expect(ratioToGainDb(0.5)).toBe(0);
  });

  it("round-trips all 29 integer dB steps", () => {
    for (let gain = EQ_GAIN_MIN; gain <= EQ_GAIN_MAX; gain += 1) {
      expect(ratioToGainDb(gainDbToRatio(gain))).toBe(gain);
    }
  });

  it("clamps out-of-range gain before ratio conversion", () => {
    expect(gainDbToRatio(-100)).toBe(0);
    expect(gainDbToRatio(100)).toBe(1);
  });
});
