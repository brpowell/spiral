import { describe, expect, it } from "vitest";
import {
  clampCrop,
  coverCrop,
  cropAtZoom,
  cropToFrameStyle,
  cropsEqual,
  imageOutputSize,
  imageOutputSizeOptions,
  panCrop,
  zoomCrop,
  zoomFromCrop,
} from "./imageCrop";

describe("coverCrop", () => {
  it("centers a square on a landscape image", () => {
    expect(coverCrop(2000, 1000, 1)).toEqual({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    });
  });

  it("centers a square on a portrait image", () => {
    expect(coverCrop(1000, 2000, 1)).toEqual({
      x: 0,
      y: 0.25,
      width: 1,
      height: 0.5,
    });
  });

  it("fills a square image", () => {
    expect(coverCrop(1000, 1000, 1)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
});

describe("cropAtZoom / zoomFromCrop", () => {
  it("halves the cover window at zoom 2", () => {
    const crop = cropAtZoom(2000, 1000, 2, 0.5, 0.5, 1);
    expect(crop.width).toBeCloseTo(0.25);
    expect(crop.height).toBeCloseTo(0.5);
    expect(crop.x).toBeCloseTo(0.375);
    expect(crop.y).toBeCloseTo(0.25);
    expect(zoomFromCrop(crop, 2000, 1000, 1)).toBeCloseTo(2);
  });

  it("clamps pan so the crop stays inside the image", () => {
    const crop = cropAtZoom(2000, 1000, 2, 0, 0, 1);
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1);
  });
});

describe("panCrop", () => {
  it("moves by frame-normalized deltas (drag image right → crop left)", () => {
    const base = coverCrop(2000, 1000, 1);
    const panned = panCrop(base, 0.5, 0);
    expect(panned.x).toBeCloseTo(base.x - 0.5 * base.width);
    expect(panned.y).toBeCloseTo(base.y);
  });

  it("clamps at edges", () => {
    const base = coverCrop(2000, 1000, 1);
    // Drag image left/up a lot → crop window hits the far edges.
    const panned = panCrop(base, -10, -10);
    expect(panned.x + panned.width).toBeCloseTo(1);
    expect(panned.y + panned.height).toBeCloseTo(1);
  });
});

describe("zoomCrop", () => {
  it("keeps the visual center when zooming", () => {
    const base = coverCrop(2000, 1000, 1);
    const zoomed = zoomCrop(base, 2000, 1000, 2, 1);
    expect(zoomed.x + zoomed.width / 2).toBeCloseTo(0.5);
    expect(zoomed.y + zoomed.height / 2).toBeCloseTo(0.5);
  });
});

describe("cropToFrameStyle", () => {
  it("maps a centered landscape cover to cover-like CSS", () => {
    const style = cropToFrameStyle(coverCrop(2000, 1000, 1));
    expect(style.width).toBe("200%");
    expect(style.height).toBe("100%");
    expect(style.left).toBe("-50%");
    expect(style.top).toBe("0%");
  });
});

describe("clampCrop / cropsEqual", () => {
  it("clamps out-of-bounds crops", () => {
    expect(clampCrop({ x: -1, y: 0.9, width: 0.5, height: 0.5 })).toEqual({
      x: 0,
      y: 0.5,
      width: 0.5,
      height: 0.5,
    });
  });

  it("compares crops with epsilon", () => {
    expect(
      cropsEqual(
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 1e-8, y: 0, width: 1, height: 1 },
      ),
    ).toBe(true);
    expect(
      cropsEqual(
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 0.1, y: 0, width: 1, height: 1 },
      ),
    ).toBe(false);
  });
});

describe("imageOutputSize", () => {
  const full = { x: 0, y: 0, width: 1, height: 1 };

  it("caps the long edge at the backend maximum", () => {
    expect(imageOutputSize(6000, 6000, full, null)).toEqual({
      maxEdge: null,
      width: 2000,
      height: 2000,
    });
  });

  it("never upscales a small crop", () => {
    expect(imageOutputSize(800, 800, full, 1500)).toMatchObject({
      width: 800,
      height: 800,
    });
  });

  it("keeps the crop's aspect ratio when scaling down", () => {
    const wide = { x: 0, y: 0, width: 1, height: 0.5 };
    expect(imageOutputSize(4000, 4000, wide, 1000)).toMatchObject({
      width: 1000,
      height: 500,
    });
  });
});

describe("imageOutputSizeOptions", () => {
  const full = { x: 0, y: 0, width: 1, height: 1 };

  it("offers every preset below the full size", () => {
    const options = imageOutputSizeOptions(6000, 6000, full);
    expect(options.map((o) => o.maxEdge)).toEqual([null, 1500, 1000, 600]);
  });

  it("drops presets the crop is already smaller than", () => {
    const options = imageOutputSizeOptions(1200, 1200, full);
    expect(options.map((o) => o.maxEdge)).toEqual([null, 1000, 600]);
  });

  it("offers only the full size for a tiny crop", () => {
    expect(imageOutputSizeOptions(500, 500, full)).toHaveLength(1);
  });
});
