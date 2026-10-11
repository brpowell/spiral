import { describe, expect, it } from "vitest";
import {
  pointInThumb,
  wmpCrossAxisOffset,
  wmpHorizontalThumbLeft,
  wmpSliderFillSpan,
  wmpVerticalPointerToRatio,
  wmpVerticalThumbTop,
} from "./wmpBitmapSliderThumb";

/** Plus! Nature volume: 25×82, borderSize 12, ladybug 24×21. */
const nature = {
  trackHeight: 82,
  thumbHeight: 21,
  borderSize: 12,
};

describe("wmpVerticalThumbTop", () => {
  it("places the thumb nearly flush at max (WMP center + half-height borderSize)", () => {
    const top = wmpVerticalThumbTop({ ratio: 1, ...nature });
    // center at borderSize (12); top = 12 - 10.5 = 1.5
    expect(top).toBeCloseTo(1.5);
  });

  it("places the thumb nearly flush at min", () => {
    const top = wmpVerticalThumbTop({ ratio: 0, ...nature });
    // center at 82 - 12 = 70; top = 70 - 10.5 = 59.5
    expect(top).toBeCloseTo(59.5);
    expect(top + nature.thumbHeight).toBeCloseTo(80.5);
  });

  it("reaches nearer the track ends than a top-edge borderSize inset", () => {
    const oldMaxTop = nature.borderSize;
    const newMaxTop = wmpVerticalThumbTop({ ratio: 1, ...nature });
    expect(newMaxTop).toBeLessThan(oldMaxTop);
  });
});

describe("wmpVerticalPointerToRatio", () => {
  it("round-trips with thumb centers", () => {
    for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
      const top = wmpVerticalThumbTop({ ratio, ...nature });
      const centerY = top + nature.thumbHeight / 2;
      expect(
        wmpVerticalPointerToRatio({
          localY: centerY,
          trackHeight: nature.trackHeight,
          borderSize: nature.borderSize,
        }),
      ).toBeCloseTo(ratio);
    }
  });
});

describe("pointInThumb", () => {
  it("is true only inside the thumb box", () => {
    const box = {
      thumbLeft: 0.5,
      thumbTop: 59.5,
      thumbWidth: 24,
      thumbHeight: 21,
    };
    expect(pointInThumb({ localX: 12, localY: 70, ...box })).toBe(true);
    expect(pointInThumb({ localX: 12, localY: 10, ...box })).toBe(false);
  });
});

describe("wmpCrossAxisOffset", () => {
  it("snaps a 1px-taller Nature seek box so the thumb does not bleed", () => {
    expect(wmpCrossAxisOffset(17, 16)).toBe(0);
    expect(wmpCrossAxisOffset(16, 16)).toBe(0);
  });

  it("snaps a 1px-wider Nature volume box", () => {
    expect(wmpCrossAxisOffset(25, 24)).toBe(0);
  });
});

describe("wmpSliderFillSpan", () => {
  it("matches the thumb center for Headspace seek geometry", () => {
    const trackWidth = 163;
    const thumbWidth = 18;
    const borderSize = 9;
    for (const ratio of [0, 0.5, 1]) {
      const left = wmpHorizontalThumbLeft({
        ratio,
        trackWidth,
        thumbWidth,
        borderSize,
      });
      expect(
        wmpSliderFillSpan({ ratio, trackLength: trackWidth, borderSize }),
      ).toBeCloseTo(left + thumbWidth / 2);
    }
  });

  it("is the full track when borderSize is 0", () => {
    expect(
      wmpSliderFillSpan({ ratio: 1, trackLength: 116, borderSize: 0 }),
    ).toBe(116);
    expect(
      wmpSliderFillSpan({ ratio: 0, trackLength: 116, borderSize: 0 }),
    ).toBe(0);
  });
});
