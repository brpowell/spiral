import { describe, expect, it } from "vitest";
import {
  buildButtonGroupHitMapFromPixels,
  parseMappingColor,
} from "./skinButtonGroupMap";

describe("parseMappingColor", () => {
  it("parses WMP-style hex colors", () => {
    expect(parseMappingColor("#0000ff")).toEqual({ r: 0, g: 0, b: 255 });
    expect(parseMappingColor("#0033ff")).toEqual({ r: 0, g: 51, b: 255 });
    expect(parseMappingColor("#0066ff")).toEqual({ r: 0, g: 102, b: 255 });
  });

  it("returns null for invalid colors", () => {
    expect(parseMappingColor("blue")).toBeNull();
    expect(parseMappingColor("#00f")).toBeNull();
  });
});

describe("buildButtonGroupHitMapFromPixels", () => {
  const WHITE = "255,255,255";
  const MAGENTA = "255,0,255";
  const RED = "255,0,0";

  /** One 10px-wide row per entry, wide enough to outrun the edge search. */
  function bands(colors: [number, number, number, number][]) {
    const width = colors.length * 10;
    const data = new Uint8ClampedArray(width * 4);
    for (let x = 0; x < width; x++) {
      data.set(colors[Math.floor(x / 10)], x * 4);
    }
    return buildButtonGroupHitMapFromPixels(data, width, 1);
  }

  const map = bands([
    [255, 255, 255, 255],
    [255, 0, 255, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 0],
  ]);

  it("hits white and magenta when an element declares them", () => {
    const declared = new Set([WHITE, MAGENTA, RED]);
    expect(map.keyAt(5, 0, declared)).toBe(WHITE);
    expect(map.keyAt(15, 0, declared)).toBe(MAGENTA);
    expect(map.regions).toContainEqual({
      colorKey: WHITE,
      x: 0,
      y: 0,
      w: 10,
      h: 1,
    });
  });

  it("passes clicks through undeclared white and magenta", () => {
    const declared = new Set([RED]);
    expect(map.keyAt(5, 0, declared)).toBeNull();
    expect(map.keyAt(15, 0, declared)).toBeNull();
    expect(map.keyAt(25, 0, declared)).toBe(RED);
  });

  it("ignores see-through pixels even when their color is declared", () => {
    const declared = new Set(["0,0,255"]);
    expect(map.keyAt(35, 0, declared)).toBeNull();
    expect(map.regions.map((r) => r.colorKey)).not.toContain("0,0,255");
  });

  it("snaps an undeclared white edge pixel to the neighboring button", () => {
    const edge = bands([
      [255, 255, 255, 255],
      [255, 0, 0, 255],
    ]);
    expect(edge.keyAt(9, 0, new Set([RED]))).toBe(RED);
  });
});
