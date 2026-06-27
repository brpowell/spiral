import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  detectDialPathFromStripPixels,
  frameFromDialAngle,
  sampleStripSliderPointer,
} from "./skinStripSliderMap";

const SLIDER_DIR = join(
  process.cwd(),
  "src-tauri/skins/builtin/t3/assets/sliders",
);

function loadPng(relativePath: string): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const png = PNG.sync.read(readFileSync(join(SLIDER_DIR, relativePath)));
  return { data: png.data, width: png.width, height: png.height };
}

function dialMapFromStrip(stripName: string, frameCount = 21) {
  const { data, width } = loadPng(stripName);
  const dialPath = detectDialPathFromStripPixels(
    data,
    width,
    27,
    27,
    frameCount,
  );
  expect(dialPath).not.toBeNull();
  return dialPath!;
}

describe("dial path pointer mapping", () => {
  it("derives the clockwise notch ring from the filmstrip", () => {
    const dialPath = dialMapFromStrip("vol-mini.png");
    const cx = 13;
    const cy = 13;

    const frameAt = (x: number, y: number) =>
      frameFromDialAngle(Math.atan2(y - cy, x - cx), dialPath, 21);

    expect(frameAt(10, 19)).toBe(0);
    expect(frameAt(13, 4)).toBe(10);
    expect(frameAt(17, 19)).toBe(20);
  });

  it("increases frame when dragging clockwise on the right side", () => {
    const dialPath = dialMapFromStrip("vol-mini.png");
    const cx = 13;
    const cy = 13;

    const frameAt = (x: number, y: number) =>
      frameFromDialAngle(Math.atan2(y - cy, x - cx), dialPath, 21);

    const atThree = frameAt(20, 13);
    const atFour = frameAt(21, 15);
    const atFive = frameAt(17, 19);

    expect(atThree).toBe(16);
    expect(atFour).toBeGreaterThan(atThree);
    expect(atFive).toBeGreaterThan(atFour);
  });

  it("ignores invert for dial controls", () => {
    const dialPath = dialMapFromStrip("vol-mini.png");
    const rect = {
      left: 0,
      top: 0,
      width: 27,
      height: 27,
      right: 27,
      bottom: 27,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;

    const map = {
      width: 27,
      height: 27,
      dialPath,
      frameAt: () => -1,
    };

    const normal = sampleStripSliderPointer(
      13,
      4,
      rect,
      map,
      21,
      "horizontal",
      false,
    );
    const inverted = sampleStripSliderPointer(
      13,
      4,
      rect,
      map,
      21,
      "horizontal",
      true,
    );

    expect(normal.source).toBe("dial");
    expect(normal.frame).toBe(10);
    expect(inverted.frame).toBe(10);
  });

  it("does not roll over in the bottom dead zone while dragging", () => {
    const dialPath = dialMapFromStrip("vol-mini.png");
    const cx = 13;
    const cy = 13;
    const deadZoneAngle = Math.atan2(26 - cy, 13 - cx);

    expect(frameFromDialAngle(deadZoneAngle, dialPath, 21, 0)).toBe(0);
    expect(frameFromDialAngle(deadZoneAngle, dialPath, 21, 20)).toBe(20);
    expect(frameFromDialAngle(deadZoneAngle, dialPath, 21)).not.toBe(20);
  });
});
