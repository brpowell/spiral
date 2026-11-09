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

describe("inferStripSliderStripLayout", () => {
  it("detects horizontal filmstrips (wide seek and volume strips)", () => {
    expect(inferStripSliderStripLayout(1898, 113, 73, 113, 26)).toBe(
      "horizontal",
    );
    expect(inferStripSliderStripLayout(1222, 128, 47, 128, 26)).toBe(
      "horizontal",
    );
  });

  it("detects vertical filmstrips (tall volume strip)", () => {
    expect(inferStripSliderStripLayout(168, 840, 168, 28, 30)).toBe("vertical");
  });

  it("detects horizontal filmstrips for a very wide seek strip", () => {
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

function rectOf(width: number, height: number): DOMRect {
  return {
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
}

/** A distinct, clearly non-gray color per band index. */
function bandColor(index: number): [number, number, number, number] {
  return [40 + 6 * index, 200 - 4 * index, 90 + 2 * index, 255];
}

/**
 * Color-keyed position map: one flat color per frame band along the
 * interaction axis. Rows above `transparentRows` are fully transparent.
 */
function bandedMap(
  width: number,
  height: number,
  bands: number,
  axis: "x" | "y",
  transparentRows = 0,
) {
  const data = makeRgba(width, height, (x, y) => {
    if (y < transparentRows) return [0, 0, 0, 0];
    const t = axis === "x" ? x / width : y / height;
    return bandColor(Math.min(bands - 1, Math.floor(t * bands)));
  });
  return { data, width, height };
}

describe("color-keyed horizontal map with descending frames", () => {
  const WIDTH = 168;
  const HEIGHT = 28;
  const FRAMES = 30;

  function build() {
    const { data } = bandedMap(WIDTH, HEIGHT, FRAMES, "x", 4);
    return buildStripSliderPositionMapFromPixels(
      data,
      WIDTH,
      HEIGHT,
      FRAMES,
      "horizontal",
      null,
      "descending",
    );
  }

  it("maps the right edge to max ratio with descending map/value frames", () => {
    const map = build();
    expect(map).not.toBeNull();
    const rect = rectOf(WIDTH, HEIGHT);

    const right = sampleStripSliderPointer(
      WIDTH - 1,
      14,
      rect,
      map,
      FRAMES,
      "horizontal",
      "descending",
    );
    const left = sampleStripSliderPointer(
      1,
      14,
      rect,
      map,
      FRAMES,
      "horizontal",
      "descending",
    );

    expect(right?.ratio).toBeCloseTo(1, 1);
    expect(left?.ratio).toBeCloseTo(0, 1);
    expect(right?.rawFrame).toBe(0);
    expect(left?.rawFrame).toBeGreaterThan(20);
  });

  it("returns null for transparent pixels above the gradient", () => {
    const map = build();
    expect(
      sampleStripSliderPointer(
        WIDTH / 2,
        0,
        rectOf(WIDTH, HEIGHT),
        map,
        FRAMES,
        "horizontal",
        "descending",
      ),
    ).toBeNull();
  });
});

describe("color-keyed vertical map with descending frames", () => {
  it("maps top above bottom", () => {
    const WIDTH = 73;
    const HEIGHT = 113;
    const FRAMES = 26;
    const { data } = bandedMap(WIDTH, HEIGHT, FRAMES, "y");
    const map = buildStripSliderPositionMapFromPixels(
      data,
      WIDTH,
      HEIGHT,
      FRAMES,
      "vertical",
      null,
      "descending",
    );
    const rect = rectOf(WIDTH, HEIGHT);
    const sample = (y: number) =>
      sampleStripSliderPointer(
        10,
        y,
        rect,
        map,
        FRAMES,
        "vertical",
        "descending",
      );

    const top = sample(8);
    const mid = sample(55);

    expect(top?.ratio).toBeGreaterThan(0.9);
    expect(mid?.ratio).toBeGreaterThan(0.4);
    expect(mid?.ratio).toBeLessThan(0.7);
    expect(top!.ratio).toBeGreaterThan(mid!.ratio);
  });
});

describe("curved grayscale ramp map", () => {
  const WIDTH = 60;
  const HEIGHT = 30;
  const FRAMES = 27;
  const TIP_X = 3;
  const END_X = 56;
  const HALO_GRAY = 100;

  /** Sine-shaped 3px stroke; black at the inner tip ramping to white. */
  function curvedRamp() {
    const centerY = (x: number) =>
      Math.round(15 + 8 * Math.sin((Math.PI * (x - TIP_X)) / (END_X - TIP_X)));
    return makeRgba(WIDTH, HEIGHT, (x, y) => {
      if (x < TIP_X) {
        // Anti-aliased halo hanging off the tip: lighter than the true tip.
        return Math.abs(y - centerY(TIP_X)) <= 1
          ? [HALO_GRAY, HALO_GRAY, HALO_GRAY, 255]
          : [0, 0, 0, 0];
      }
      if (x > END_X || Math.abs(y - centerY(x)) > 1) return [0, 0, 0, 0];
      const gray = Math.round((255 * (x - TIP_X)) / (END_X - TIP_X));
      return [gray, gray, gray, 255];
    });
  }

  it("reaches frame 0 and the last frame at the stroke tips", () => {
    const map = buildStripSliderPositionMapFromPixels(
      curvedRamp(),
      WIDTH,
      HEIGHT,
      FRAMES,
      "horizontal",
    );
    expect(map).not.toBeNull();

    let minFrame = 99;
    let maxFrame = -1;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const frame = map!.frameAt(x, y);
        if (frame < 0) continue;
        minFrame = Math.min(minFrame, frame);
        maxFrame = Math.max(maxFrame, frame);
      }
    }
    expect(minFrame).toBe(0);
    expect(maxFrame).toBe(FRAMES - 1);
  });

  it("inverts the ramp for descending map frames", () => {
    const map = buildStripSliderPositionMapFromPixels(
      curvedRamp(),
      WIDTH,
      HEIGHT,
      FRAMES,
      "horizontal",
      null,
      "descending",
    )!;
    const yAt = (x: number) =>
      Math.round(15 + 8 * Math.sin((Math.PI * (x - TIP_X)) / (END_X - TIP_X)));
    // Black tip becomes the last frame, white end becomes frame 0.
    expect(map.frameAt(TIP_X, yAt(TIP_X))).toBe(FRAMES - 1);
    expect(map.frameAt(END_X, yAt(END_X))).toBe(0);
  });

  it("does not treat the anti-aliased halo as the minimum", () => {
    const map = buildStripSliderPositionMapFromPixels(
      curvedRamp(),
      WIDTH,
      HEIGHT,
      FRAMES,
      "horizontal",
    )!;
    const tipY = Math.round(15 + 8 * Math.sin((Math.PI * 0) / (END_X - TIP_X)));
    // The spatially leftmost mapped pixel is the halo; the true minimum is
    // the black tip further in.
    expect(map.frameAt(TIP_X, tipY)).toBe(0);
    expect(map.frameAt(0, tipY)).toBeGreaterThan(0);
  });
});

describe("dial path pointer mapping", () => {
  const FRAME_SIZE = 27;
  const FRAMES = 21;
  const CENTER = (FRAME_SIZE - 1) / 2;
  const RING_RADIUS = 11;
  // Clockwise sweep (screen coordinates) from lower-left, over the top,
  // to lower-right, leaving a dead zone at the bottom.
  const START = Math.atan2(6, -3);
  const END = Math.atan2(6, 4) + Math.PI * 2;

  /** Filmstrip of round dials; each frame's blue pointer sits on the ring. */
  function dialStrip() {
    const stripWidth = FRAME_SIZE * FRAMES;
    const data = makeRgba(stripWidth, FRAME_SIZE, (sx, y) => {
      const frame = Math.floor(sx / FRAME_SIZE);
      const x = sx - frame * FRAME_SIZE;
      const angle = START + ((END - START) * frame) / (FRAMES - 1);
      const px = Math.round(CENTER + RING_RADIUS * Math.cos(angle));
      const py = Math.round(CENTER + RING_RADIUS * Math.sin(angle));
      if (x === px && y === py) return [0, 0, 255, 255];
      const dist = Math.hypot(x - CENTER, y - CENTER);
      return dist <= 12 ? [60, 60, 60, 255] : [0, 0, 0, 0];
    });
    return { data, stripWidth };
  }

  function dialPath() {
    const { data, stripWidth } = dialStrip();
    const path = detectDialPathFromStripPixels(
      data,
      stripWidth,
      FRAME_SIZE,
      FRAME_SIZE,
      FRAMES,
    );
    expect(path).not.toBeNull();
    return path!;
  }

  const frameAt = (path: ReturnType<typeof dialPath>, x: number, y: number) =>
    frameFromDialAngle(Math.atan2(y - CENTER, x - CENTER), path, FRAMES);

  it("derives the clockwise notch ring from the filmstrip", () => {
    const path = dialPath();
    expect(frameAt(path, 10, 19)).toBe(0);
    expect(frameAt(path, 13, 4)).toBe(10);
    expect(frameAt(path, 17, 19)).toBe(20);
  });

  it("increases frame when dragging clockwise on the right side", () => {
    const path = dialPath();
    const atThree = frameAt(path, 20, 13);
    const atFour = frameAt(path, 21, 15);
    const atFive = frameAt(path, 17, 19);

    expect(atThree).toBe(16);
    expect(atFour).toBeGreaterThan(atThree);
    expect(atFive).toBeGreaterThan(atFour);
  });

  it("ignores valueFrames for dial controls", () => {
    const map = {
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      dialPath: dialPath(),
      frameAt: () => -1,
    };
    const rect = rectOf(FRAME_SIZE, FRAME_SIZE);
    const sample = (valueFrames: "ascending" | "descending") =>
      sampleStripSliderPointer(
        13,
        4,
        rect,
        map,
        FRAMES,
        "horizontal",
        valueFrames,
      );

    const ascending = sample("ascending")!;
    const descending = sample("descending")!;

    expect(ascending.source).toBe("dial");
    expect(ascending.frame).toBe(10);
    expect(descending.frame).toBe(10);
    expect(descending.ratio).toBe(ascending.ratio);
  });

  it("does not roll over in the bottom dead zone while dragging", () => {
    const path = dialPath();
    const deadZoneAngle = Math.atan2(FRAME_SIZE - 1 - CENTER, 0);

    expect(frameFromDialAngle(deadZoneAngle, path, FRAMES, 0)).toBe(0);
    expect(frameFromDialAngle(deadZoneAngle, path, FRAMES, 20)).toBe(20);
    expect(frameFromDialAngle(deadZoneAngle, path, FRAMES)).not.toBe(20);
  });
});
