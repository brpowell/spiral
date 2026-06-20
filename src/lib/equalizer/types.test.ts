import { describe, expect, it } from "vitest";
import {
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  formatEqBandFrequencyLabel,
  formatEqGainDb,
  formatEqScaleDb,
  gainDbToRatio,
  ratioToGainDb,
  snapBandGainNearZero,
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

  it("round-trips all 25 integer dB steps", () => {
    for (let gain = EQ_GAIN_MIN; gain <= EQ_GAIN_MAX; gain += 1) {
      expect(ratioToGainDb(gainDbToRatio(gain))).toBe(gain);
    }
  });

  it("clamps out-of-range gain before ratio conversion", () => {
    expect(gainDbToRatio(-100)).toBe(0);
    expect(gainDbToRatio(100)).toBe(1);
  });
});

describe("snapBandGainNearZero", () => {
  it("snaps gains within the center threshold to 0 dB", () => {
    expect(snapBandGainNearZero(0)).toBe(0);
    expect(snapBandGainNearZero(0.9)).toBe(0);
    expect(snapBandGainNearZero(-0.9)).toBe(0);
    expect(snapBandGainNearZero(0.94)).toBe(0);
  });

  it("leaves gains at or beyond the threshold unchanged", () => {
    expect(snapBandGainNearZero(1)).toBe(1);
    expect(snapBandGainNearZero(-1)).toBe(-1);
    expect(snapBandGainNearZero(6.2)).toBe(6.2);
  });
});

describe("formatEqBandFrequencyLabel", () => {
  it("formats sub-kHz bands as numbers and kHz bands with K", () => {
    expect(formatEqBandFrequencyLabel(31)).toBe("31");
    expect(formatEqBandFrequencyLabel(500)).toBe("500");
    expect(formatEqBandFrequencyLabel(1_000)).toBe("1K");
    expect(formatEqBandFrequencyLabel(16_000)).toBe("16K");
  });
});

describe("formatEqGainDb / formatEqScaleDb", () => {
  it("formats gain with units for band readouts", () => {
    expect(formatEqGainDb(0)).toBe("+0.0 dB");
    expect(formatEqGainDb(6)).toBe("+6.0 dB");
    expect(formatEqGainDb(-8)).toBe("-8.0 dB");
    expect(formatEqGainDb(1.25)).toBe("+1.3 dB");
  });

  it("formats compact scale ticks without units", () => {
    expect(formatEqScaleDb(0)).toBe("0");
    expect(formatEqScaleDb(12)).toBe("+12");
    expect(formatEqScaleDb(-6)).toBe("-6");
  });
});
