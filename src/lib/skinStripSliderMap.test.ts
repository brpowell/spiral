import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  buildStripSliderPositionMapFromPixels,
  detectDialPathFromStripPixels,
  frameFromDialAngle,
  inferStripSliderStripLayout,
  ratioToStripFrame,
  sampleStripSliderPointer,
  stripFrameToRatio,
} from "./skinStripSliderMap";

const SLIDER_DIR = join(process.cwd(), "testdata/skins/sliders");
const XBOX_SLIDER_DIR = join(process.cwd(), "testdata/skins/sliders");

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

describe("inferStripSliderStripLayout", () => {
  it("detects horizontal filmstrips (t3 seek / vol)", () => {
    expect(inferStripSliderStripLayout(1898, 113, 73, 113, 26)).toBe(
      "horizontal",
    );
    expect(inferStripSliderStripLayout(1222, 128, 47, 128, 26)).toBe(
      "horizontal",
    );
  });

  it("detects vertical filmstrips (xbox vol)", () => {
    expect(inferStripSliderStripLayout(168, 840, 168, 28, 30)).toBe("vertical");
  });

  it("detects horizontal filmstrips for xbox seek", () => {
    expect(inferStripSliderStripLayout(4192, 13, 131, 13, 32)).toBe(
      "horizontal",
    );
  });
});

describe("valueFrames mapping", () => {
  it("ascending maps ratio 0/1 to first/last frames", () => {
    expect(ratioToStripFrame(0, 30, "ascending")).toBe(0);
    expect(ratioToStripFrame(1, 30, "ascending")).toBe(29);
    expect(stripFrameToRatio(0, 30, "ascending")).toBe(0);
    expect(stripFrameToRatio(29, 30, "ascending")).toBe(1);
  });

  it("descending inverts both directions symmetrically", () => {
    expect(ratioToStripFrame(0, 30, "descending")).toBe(29);
    expect(ratioToStripFrame(1, 30, "descending")).toBe(0);
    expect(stripFrameToRatio(0, 30, "descending")).toBe(1);
    expect(stripFrameToRatio(29, 30, "descending")).toBe(0);
  });

  it("round-trips ascending ratio through frame index", () => {
    for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
      const frame = ratioToStripFrame(ratio, 30, "ascending");
      expect(stripFrameToRatio(frame, 30, "ascending")).toBeCloseTo(ratio, 1);
    }
  });
});

describe("xbox volume position map", () => {
  it("maps pointer at right edge to max ratio with descending map/value frames", () => {
    const png = PNG.sync.read(
      readFileSync(join(XBOX_SLIDER_DIR, "vol-map.png")),
    );
    const map = buildStripSliderPositionMapFromPixels(
      png.data,
      png.width,
      png.height,
      30,
      "horizontal",
      null,
      "descending",
    );
    expect(map).not.toBeNull();

    const rect = {
      left: 0,
      top: 0,
      width: 168,
      height: 28,
      right: 168,
      bottom: 28,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;

    const right = sampleStripSliderPointer(
      167,
      14,
      rect,
      map,
      30,
      "horizontal",
      "descending",
    );
    const left = sampleStripSliderPointer(
      1,
      14,
      rect,
      map,
      30,
      "horizontal",
      "descending",
    );

    expect(right?.ratio).toBeCloseTo(1, 1);
    expect(left?.ratio).toBeCloseTo(0, 1);
    expect(right?.rawFrame).toBe(0);
    expect(left?.rawFrame).toBeGreaterThan(20);
  });

  it("returns null for transparent pixels above the gradient", () => {
    const png = PNG.sync.read(
      readFileSync(join(XBOX_SLIDER_DIR, "vol-map.png")),
    );
    const map = buildStripSliderPositionMapFromPixels(
      png.data,
      png.width,
      png.height,
      30,
      "horizontal",
      null,
      "descending",
    );
    const rect = {
      left: 0,
      top: 0,
      width: 168,
      height: 28,
      right: 168,
      bottom: 28,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;

    expect(
      sampleStripSliderPointer(
        84,
        0,
        rect,
        map,
        30,
        "horizontal",
        "descending",
      ),
    ).toBeNull();
  });
});

describe("t3 seek position map", () => {
  it("maps top above bottom with vertical descending map/value frames", () => {
    const png = PNG.sync.read(readFileSync(join(SLIDER_DIR, "seek-map.png")));
    const map = buildStripSliderPositionMapFromPixels(
      png.data,
      png.width,
      png.height,
      26,
      "vertical",
      null,
      "descending",
    );
    const rect = {
      left: 0,
      top: 0,
      width: 73,
      height: 113,
      right: 73,
      bottom: 113,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;

    const top = sampleStripSliderPointer(
      10,
      8,
      rect,
      map,
      26,
      "vertical",
      "descending",
    );
    const mid = sampleStripSliderPointer(
      10,
      55,
      rect,
      map,
      26,
      "vertical",
      "descending",
    );

    expect(top?.ratio).toBeGreaterThan(0.9);
    expect(mid?.ratio).toBeGreaterThan(0.4);
    expect(mid?.ratio).toBeLessThan(0.7);
    expect(top!.ratio).toBeGreaterThan(mid!.ratio);
  });
});

function makeRgba(
  width: number,
  height: number,
  plot: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = plot(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
}

describe("grayscale luminance maps", () => {
  const width = 32;
  const height = 12;

  /** Curved-track style: leftmost pixels are mid-gray; true black sits inward. */
  function curvedRampMap() {
    const data = makeRgba(width, height, (x, y) => {
      if (y < 3 || y > 8) return [255, 0, 255, 255];
      if (x === 1) return [80, 80, 80, 255];
      if (x >= 3 && x <= 5) return [0, 0, 0, 255];
      if (x >= 26 && x <= 28) return [255, 255, 255, 255];
      if (x > 5 && x < 26) {
        const g = Math.round(((x - 5) / 21) * 255);
        return [g, g, g, 255];
      }
      return [255, 0, 255, 255];
    });
    return buildStripSliderPositionMapFromPixels(
      data,
      width,
      height,
      27,
      "horizontal",
    );
  }

  it("maps black to frame 0 even when darker pixels are not the leftmost", () => {
    const map = curvedRampMap();
    expect(map).not.toBeNull();
    expect(map!.frameAt(4, 5)).toBe(0);
    expect(map!.frameAt(27, 5)).toBe(26);
    expect(map!.frameAt(1, 5)).toBeGreaterThan(0);
  });

  it("snaps off-map samples to the nearest mapped frame while dragging", () => {
    const map = curvedRampMap();
    expect(map).not.toBeNull();
    const rect = {
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;

    expect(
      sampleStripSliderPointer(0, 5, rect, map, 27, "horizontal"),
    ).toBeNull();

    const pastLeft = sampleStripSliderPointer(
      0,
      5,
      rect,
      map,
      27,
      "horizontal",
      "ascending",
      undefined,
      "nearest",
    );
    expect(pastLeft?.rawFrame).toBe(0);
    expect(pastLeft?.ratio).toBe(0);
    expect(pastLeft?.source).toBe("map");

    const pastRight = sampleStripSliderPointer(
      31,
      5,
      rect,
      map,
      27,
      "horizontal",
      "ascending",
      undefined,
      "nearest",
    );
    expect(pastRight?.rawFrame).toBe(26);
    expect(pastRight?.ratio).toBe(1);
  });
});

describe("lost planet curved maps", () => {
  function loadPackMap(name: string) {
    const png = PNG.sync.read(readFileSync(join(SLIDER_DIR, name)));
    return {
      png,
      map: buildStripSliderPositionMapFromPixels(
        png.data,
        png.width,
        png.height,
        27,
        "horizontal",
      ),
    };
  }

  it("reaches frame 0 and last on seek and volume tips", () => {
    for (const file of [
      "lost-planet-seek-map.png",
      "lost-planet-volume-map.png",
    ]) {
      const { png, map } = loadPackMap(file);
      expect(map).not.toBeNull();
      let minFrame = 99;
      let maxFrame = -1;
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
          const frame = map!.frameAt(x, y);
          if (frame < 0) continue;
          minFrame = Math.min(minFrame, frame);
          maxFrame = Math.max(maxFrame, frame);
        }
      }
      expect(minFrame, file).toBe(0);
      expect(maxFrame, file).toBe(26);
    }
  });
});

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

  it("ignores valueFrames for dial controls", () => {
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

    const ascending = sampleStripSliderPointer(
      13,
      4,
      rect,
      map,
      21,
      "horizontal",
      "ascending",
    );
    const descending = sampleStripSliderPointer(
      13,
      4,
      rect,
      map,
      21,
      "horizontal",
      "descending",
    );

    expect(ascending.source).toBe("dial");
    expect(ascending.frame).toBe(10);
    expect(descending.frame).toBe(10);
    expect(descending.ratio).toBe(ascending.ratio);
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
