import { describe, expect, it } from "vitest";
import {
  MAX_AUDIO_FREQUENCY_BINS,
  MAX_AUDIO_WAVEFORM_SAMPLES,
  MAX_RENDERER_SOURCE_BYTES,
  MAX_VIZ_PIXEL_AREA,
  MAX_VIZ_PIXEL_HEIGHT,
  MAX_VIZ_PIXEL_WIDTH,
  assertAudioBuffersWithinBudget,
  assertCanvasWithinBudget,
  assertPixelBudget,
  assertRendererSourceWithinBudget,
  clampVizRenderSize,
  isWithinPixelBudget,
} from "./resourceBudgets";

describe("clampVizRenderSize", () => {
  it("passes through modest viewports", () => {
    const size = clampVizRenderSize(800, 450, 2);
    expect(size.width).toBe(800);
    expect(size.height).toBe(450);
    expect(size.dpr).toBe(2);
    expect(size.pixelWidth).toBe(1600);
    expect(size.pixelHeight).toBe(900);
  });

  it("caps extreme DPR / CSS so pixel area stays in budget", () => {
    const size = clampVizRenderSize(4000, 3000, 4);
    expect(size.pixelWidth).toBeLessThanOrEqual(MAX_VIZ_PIXEL_WIDTH);
    expect(size.pixelHeight).toBeLessThanOrEqual(MAX_VIZ_PIXEL_HEIGHT);
    expect(size.pixelWidth * size.pixelHeight).toBeLessThanOrEqual(
      MAX_VIZ_PIXEL_AREA,
    );
    expect(isWithinPixelBudget(size.pixelWidth, size.pixelHeight)).toBe(true);
  });

  it("handles non-finite input", () => {
    const size = clampVizRenderSize(Number.NaN, -10, Number.POSITIVE_INFINITY);
    expect(size.pixelWidth).toBeGreaterThanOrEqual(1);
    expect(size.pixelHeight).toBeGreaterThanOrEqual(1);
    expect(isWithinPixelBudget(size.pixelWidth, size.pixelHeight)).toBe(true);
  });
});

describe("budget assertions", () => {
  it("accepts in-budget canvas/bitmap", () => {
    expect(() =>
      assertCanvasWithinBudget({ width: 1920, height: 1080 }),
    ).not.toThrow();
    expect(() => assertPixelBudget("bitmap", 1920, 1080)).not.toThrow();
  });

  it("rejects oversized canvas/bitmap", () => {
    expect(() =>
      assertCanvasWithinBudget({
        width: MAX_VIZ_PIXEL_WIDTH + 1,
        height: 100,
      }),
    ).toThrow(/pixel budget/);
    expect(() =>
      assertPixelBudget(
        "bitmap",
        MAX_VIZ_PIXEL_WIDTH,
        MAX_VIZ_PIXEL_HEIGHT + 1,
      ),
    ).toThrow(/pixel budget/);
  });

  it("rejects oversized audio and source", () => {
    expect(() =>
      assertAudioBuffersWithinBudget(
        new Float32Array(MAX_AUDIO_FREQUENCY_BINS + 1),
        new Float32Array(16),
      ),
    ).toThrow(/frequency buffer/);
    expect(() =>
      assertAudioBuffersWithinBudget(
        new Float32Array(16),
        new Float32Array(MAX_AUDIO_WAVEFORM_SAMPLES + 1),
      ),
    ).toThrow(/waveform buffer/);
    expect(() =>
      assertRendererSourceWithinBudget("x".repeat(MAX_RENDERER_SOURCE_BYTES + 1)),
    ).toThrow(/renderer source/);
  });
});
