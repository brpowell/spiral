import { describe, expect, it } from "vitest";
import {
  computeChromeClipPath,
  computeContentRect,
  computeStretchTileUnitH,
  computeTiledFrameRects,
  frameRectZIndex,
  partitionTiledFrameRects,
  TILED_FRAME_CONTENT_Z,
} from "./skinTiledFrame";
import type { TiledFramePresentation } from "../types/skin";

const plPresentation: TiledFramePresentation = {
  kind: "tiledFrame",
  frameThickness: 53,
  contentInset: { left: 24, top: 43, right: 23, bottom: 23 },
  assets: {
    topLeft: "frame/f_top_left",
    topCenter: "frame/f_top_center",
    topRight: "frame/f_top_right",
    topStretch: "frame/f_top_s",
    topStretch2: "frame/f_top_s_2",
    leftStretch: "frame/f_left_s",
    rightStretch: "frame/f_right_s",
    bottomLeft: "frame/f_bot_left",
    bottomCenter: "frame/f_bot_center",
    bottomRight: "frame/f_bot_right",
    bottomStretch: "frame/f_bot_s",
    bottomStretch2: "frame/f_bot_s_2",
    resizeGrip: "frame/f_resize",
  },
  tileSizes: {
    topLeft: { w: 79, h: 53 },
    topCenter: { w: 113, h: 53 },
    topRight: { w: 55, h: 53 },
    topStretch: { w: 49, h: 102, artHeight: 53 },
    topStretch2: { w: 1, h: 89, artHeight: 53 },
    leftStretch: { w: 79, h: 139 },
    rightStretch: { w: 55, h: 139 },
    bottomLeft: { w: 30, h: 53 },
    bottomCenter: { w: 186, h: 53 },
    bottomRight: { w: 130, h: 53 },
    bottomStretch: { w: 4, h: 53 },
    bottomStretch2: { w: 17, h: 53 },
    resizeGrip: { w: 23, h: 24 },
  },
};

describe("computeContentRect", () => {
  it("subtracts insets from window size", () => {
    expect(computeContentRect(279, 245, plPresentation.contentInset)).toEqual({
      x: 24,
      y: 43,
      w: 232,
      h: 179,
    });
  });

  it("grows with stretched window", () => {
    expect(computeContentRect(414, 300, plPresentation.contentInset)).toEqual({
      x: 24,
      y: 43,
      w: 367,
      h: 234,
    });
  });
});

describe("computeStretchTileUnitH", () => {
  it("elongates tall WMP stretch tiles to fill the frame band", () => {
    expect(computeStretchTileUnitH(53, { h: 102, artHeight: 53 })).toBe(102);
    expect(computeStretchTileUnitH(53, { h: 89, artHeight: 53 })).toBe(89);
  });

  it("keeps display height when no art band is declared", () => {
    expect(computeStretchTileUnitH(53, { h: 53 })).toBe(53);
  });
});

describe("computeTiledFrameRects", () => {
  it("centers top and bottom pieces at default plView size", () => {
    const rects = computeTiledFrameRects(279, 245, plPresentation);
    const topCenter = rects.find((r) => r.asset === "frame/f_top_center");
    const bottomCenter = rects.find((r) => r.asset === "frame/f_bot_center");
    expect(topCenter).toMatchObject({
      x: 83,
      y: 0,
      w: 113,
      h: 53,
      layer: "chrome",
    });
    expect(bottomCenter).toMatchObject({
      x: 46,
      y: 192,
      w: 186,
      h: 53,
      layer: "chrome",
    });
  });

  it("places left and right top stretch tiles per WMP layout", () => {
    const rects = computeTiledFrameRects(279, 245, plPresentation);
    const topStretchLeft = rects.find((r) => r.asset === "frame/f_top_s_2");
    const topStretchRight = rects.find((r) => r.asset === "frame/f_top_s");
    expect(topStretchLeft).toMatchObject({
      x: 79,
      w: 4,
      h: 53,
      tiled: "horizontal",
      layer: "stretchSecondary",
      tileUnitH: 89,
    });
    expect(topStretchRight).toMatchObject({
      x: 83,
      h: 53,
      w: Math.floor(279 / 2) + 10,
      tiled: "horizontal",
      layer: "stretch",
      tileUnitH: 102,
    });
  });

  it("grows left top stretch when window widens", () => {
    const rects = computeTiledFrameRects(414, 300, plPresentation);
    const topStretchLeft = rects.find((r) => r.asset === "frame/f_top_s_2");
    expect(topStretchLeft).toMatchObject({ x: 79, w: 71 });
  });

  it("applies checkPlViewSize stretch widths at default size", () => {
    const rects = computeTiledFrameRects(279, 245, plPresentation);
    const bottomStretch = rects.find((r) => r.asset === "frame/f_bot_s");
    const bottomStretchLeft = rects.find((r) => r.asset === "frame/f_bot_s_2");
    expect(bottomStretch).toMatchObject({
      x: 46,
      h: 53,
      w: Math.floor(279 / 2),
      tiled: "horizontal",
      layer: "stretch",
    });
    expect(bottomStretchLeft).toMatchObject({
      x: 30,
      w: 16,
      h: 53,
      layer: "stretchSecondary",
    });
  });

  it("updates right top stretch width when window grows", () => {
    const rects = computeTiledFrameRects(414, 300, plPresentation);
    const topStretchRight = rects.find((r) => r.asset === "frame/f_top_s");
    const bottomStretch = rects.find((r) => r.asset === "frame/f_bot_s");
    expect(topStretchRight?.w).toBe(Math.floor(414 / 2) + 10);
    expect(topStretchRight?.x).toBe(Math.floor((414 - 113) / 2));
    expect(bottomStretch?.w).toBe(Math.floor(414 / 2));
    const topCenter = rects.find((r) => r.asset === "frame/f_top_center");
    expect(topCenter?.x).toBe(Math.floor((414 - 113) / 2));
  });

  it("places resize grip at bottom-right", () => {
    const rects = computeTiledFrameRects(279, 245, plPresentation);
    const grip = rects.find((r) => r.asset === "frame/f_resize");
    expect(grip).toMatchObject({ x: 256, y: 221, w: 23, h: 24 });
  });

  it("layers content between stretch bands and chrome caps", () => {
    const rects = computeTiledFrameRects(279, 245, plPresentation);
    const { stretchTiles, chromeTiles } = partitionTiledFrameRects(rects);
    expect(stretchTiles.length).toBeGreaterThan(0);
    expect(chromeTiles.length).toBeGreaterThan(0);
    expect(stretchTiles.every((t) => frameRectZIndex(t.layer) < TILED_FRAME_CONTENT_Z))
      .toBe(true);
    expect(chromeTiles.every((t) => frameRectZIndex(t.layer) > TILED_FRAME_CONTENT_Z))
      .toBe(true);
  });
});

describe("computeChromeClipPath", () => {
  it("punches the content rect out of the chrome layer", () => {
    const content = computeContentRect(279, 245, plPresentation.contentInset);
    expect(computeChromeClipPath(279, 245, content)).toBe(
      "polygon(evenodd,0px 0px, 279px 0px, 279px 245px, 0px 245px, 0px 0px," +
        "24px 43px, 256px 43px, 256px 222px, 24px 222px, 24px 43px)",
    );
  });
});
