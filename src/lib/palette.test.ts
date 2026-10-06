import { describe, expect, it } from "vitest";
import { getDefaultPalette, normalizeVisualizerPalette } from "./palette";

function lightness(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

describe("normalizeVisualizerPalette", () => {
  it("lifts a near-black swatch without changing its hue", () => {
    const colors = ["#e05090", "#f0a0c0", "#a06070", "#1a0810", "#e8c0d0"];
    const normalized = normalizeVisualizerPalette(colors);
    const lifted = normalized[3] ?? "";

    expect(normalized.slice(0, 3)).toEqual(colors.slice(0, 3));
    expect(normalized[4]).toBe(colors[4]);
    expect(lightness(lifted)).toBeGreaterThan(lightness("#1a0810"));
    expect(lightness(lifted)).toBeGreaterThan(0.4);

    const n = Number.parseInt(lifted.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it("leaves a palette that is already evenly dark alone", () => {
    const colors = ["#3a3438", "#403a3e", "#383236", "#342e32", "#3c363a"];
    expect(normalizeVisualizerPalette(colors)).toEqual(colors);
  });

  it("is stable once the dark swatch has been lifted", () => {
    const once = normalizeVisualizerPalette([
      "#e05090",
      "#f0a0c0",
      "#a06070",
      "#1a0810",
      "#e8c0d0",
    ]);
    expect(normalizeVisualizerPalette(once)).toEqual(once);
  });
});

describe("getDefaultPalette", () => {
  it("does not keep the raw fallback's dark middle swatch", () => {
    const palette = getDefaultPalette();
    expect(palette).toHaveLength(5);
    expect(lightness(palette[3] ?? "")).toBeGreaterThan(lightness("#3d3566"));
  });
});
