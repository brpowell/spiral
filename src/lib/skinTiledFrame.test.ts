import { describe, expect, it } from "vitest";
import { resolveStretchBounds } from "./skinPanels";
import {
  computeChromeClipPath,
  computeContentRect,
  computeExplicitTiledFrameRects,
  computeStretchTileUnitH,
  computeTiledFrameLayoutRects,
  computeTiledFramePresetRects,
  partitionTiledFrameRects,
  TILED_FRAME_CONTENT_Z,
} from "./skinTiledFrame";
import type {
  TiledFrameExplicitPresentation,
  TiledFramePresetPresentation,
} from "../types/skin";

const plPresentation: TiledFramePresetPresentation = {
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

describe("resolveStretchBounds", () => {
  it("resolves fixed left bounds", () => {
    expect(resolveStretchBounds({ x: 77, y: 24, w: 153, h: 36 }, 448, 316)).toEqual({
      x: 77,
      y: 24,
      w: 153,
      h: 36,
      zIndex: undefined,
    });
  });

  it("resolves horizontal stretch from x and right insets", () => {
    expect(resolveStretchBounds({ x: 230, right: 163, y: 24, h: 36 }, 448, 316)).toEqual({
      x: 230,
      y: 24,
      w: 55,
      h: 36,
      zIndex: undefined,
    });
  });

  it("resolves vertical stretch from y and bottom insets", () => {
    expect(resolveStretchBounds({ x: 24, y: 177, w: 36, bottom: 133 }, 448, 316)).toEqual({
      x: 24,
      y: 177,
      w: 36,
      h: 6,
      zIndex: undefined,
    });
  });

  it("resolves bottom-anchored fixed caps", () => {
    expect(resolveStretchBounds({ x: 0, bottom: 77, w: 77, h: 77 }, 448, 316)).toEqual({
      x: 0,
      y: 239,
      w: 77,
      h: 77,
      zIndex: undefined,
    });
  });

  it("resolves right-anchored fixed caps", () => {
    expect(resolveStretchBounds({ right: 163, y: 24, w: 86, h: 36 }, 448, 316)).toEqual({
      x: 285,
      y: 24,
      w: 86,
      h: 36,
      zIndex: undefined,
    });
  });
});

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

describe("computeTiledFramePresetRects", () => {
  it("centers top and bottom pieces at default plView size", () => {
    const rects = computeTiledFramePresetRects(279, 245, plPresentation);
    const topCenter = rects.find((r) => r.asset === "frame/f_top_center");
    const bottomCenter = rects.find((r) => r.asset === "frame/f_bot_center");
    expect(topCenter).toMatchObject({
      x: 83,
      y: 0,
      w: 113,
      h: 53,
      zIndex: 2,
    });
    expect(bottomCenter).toMatchObject({
      x: 46,
      y: 192,
      w: 186,
      h: 53,
      zIndex: 2,
    });
  });

  it("places left and right top stretch tiles per WMP layout", () => {
    const rects = computeTiledFramePresetRects(279, 245, plPresentation);
    const topStretchLeft = rects.find((r) => r.asset === "frame/f_top_s_2");
    const topStretchRight = rects.find((r) => r.asset === "frame/f_top_s");
    expect(topStretchLeft).toMatchObject({
      x: 79,
      w: 4,
      h: 53,
      tiled: "horizontal",
      zIndex: 0,
      tileUnitH: 89,
    });
    expect(topStretchRight).toMatchObject({
      x: 83,
      h: 53,
      w: Math.floor(279 / 2) + 10,
      tiled: "horizontal",
      zIndex: 0,
      tileUnitH: 102,
    });
  });

  it("grows left top stretch when window widens", () => {
    const rects = computeTiledFramePresetRects(414, 300, plPresentation);
    const topStretchLeft = rects.find((r) => r.asset === "frame/f_top_s_2");
    expect(topStretchLeft).toMatchObject({ x: 79, w: 71 });
  });

  it("applies checkPlViewSize stretch widths at default size", () => {
    const rects = computeTiledFramePresetRects(279, 245, plPresentation);
    const bottomStretch = rects.find((r) => r.asset === "frame/f_bot_s");
    const bottomStretchLeft = rects.find((r) => r.asset === "frame/f_bot_s_2");
    expect(bottomStretch).toMatchObject({
      x: 46,
      h: 53,
      w: Math.floor(279 / 2),
      tiled: "horizontal",
      zIndex: 0,
    });
    expect(bottomStretchLeft).toMatchObject({
      x: 30,
      w: 16,
      h: 53,
      zIndex: 0,
    });
  });

  it("updates right top stretch width when window grows", () => {
    const rects = computeTiledFramePresetRects(414, 300, plPresentation);
    const topStretchRight = rects.find((r) => r.asset === "frame/f_top_s");
    const bottomStretch = rects.find((r) => r.asset === "frame/f_bot_s");
    expect(topStretchRight?.w).toBe(Math.floor(414 / 2) + 10);
    expect(topStretchRight?.x).toBe(Math.floor((414 - 113) / 2));
    expect(bottomStretch?.w).toBe(Math.floor(414 / 2));
    const topCenter = rects.find((r) => r.asset === "frame/f_top_center");
    expect(topCenter?.x).toBe(Math.floor((414 - 113) / 2));
  });

  it("places resize grip at bottom-right", () => {
    const rects = computeTiledFramePresetRects(279, 245, plPresentation);
    const grip = rects.find((r) => r.asset === "frame/f_resize");
    expect(grip).toMatchObject({ x: 256, y: 221, w: 23, h: 24, zIndex: 3 });
  });

  it("layers content between stretch bands and chrome caps", () => {
    const rects = computeTiledFramePresetRects(279, 245, plPresentation);
    const { underContentTiles, overContentTiles } = partitionTiledFrameRects(rects);
    expect(underContentTiles.length).toBeGreaterThan(0);
    expect(overContentTiles.length).toBeGreaterThan(0);
    expect(underContentTiles.every((t) => t.zIndex < TILED_FRAME_CONTENT_Z)).toBe(true);
    expect(overContentTiles.every((t) => t.zIndex > TILED_FRAME_CONTENT_Z)).toBe(true);
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

const xboxExplicitPresentation: TiledFrameExplicitPresentation = {
  kind: "tiledFrame",
  contentInset: { left: 46, top: 47, right: 45, bottom: 49 },
  tiles: [
    {
      asset: "frame/f_top_center.png",
      bounds: { x: 65, right: 65, y: 0, h: 24 },
      repeat: "horizontal",
      tileUnit: { w: 276, h: 24 },
    },
    {
      asset: "frame/f_outer_bot.png",
      bounds: { x: 65, right: 65, bottom: 24, h: 24 },
      repeat: "horizontal",
      tileUnit: { w: 276, h: 24 },
    },
    {
      asset: "frame/f_left_s.png",
      bounds: { x: 0, y: 65, w: 24, bottom: 77 },
      repeat: "vertical",
      tileUnit: { w: 24, h: 184 },
    },
    {
      asset: "frame/f_right_s.png",
      bounds: { right: 24, y: 65, w: 24, bottom: 77 },
      repeat: "vertical",
      tileUnit: { w: 24, h: 184 },
    },
    {
      asset: "frame/f_top_s.png",
      bounds: { x: 230, right: 163, y: 24, h: 36 },
      repeat: "horizontal",
      tileUnit: { w: 5, h: 36 },
    },
    {
      asset: "frame/f_bot_s.png",
      bounds: { x: 230, right: 163, bottom: 60, h: 47 },
      repeat: "horizontal",
      tileUnit: { w: 5, h: 47 },
    },
    {
      asset: "frame/f_inner_left_s.png",
      bounds: { x: 24, y: 177, w: 36, bottom: 133 },
      repeat: "vertical",
      tileUnit: { w: 36, h: 6 },
    },
    {
      asset: "frame/f_inner_right_s.png",
      bounds: { right: 60, y: 177, w: 36, bottom: 133 },
      repeat: "vertical",
      tileUnit: { w: 36, h: 6 },
    },
    {
      asset: "frame/f_top_left.png",
      bounds: { x: 0, y: 0, w: 77, h: 77 },
      zIndex: 2,
    },
    {
      asset: "frame/f_top_right.png",
      bounds: { right: 77, y: 0, w: 77, h: 77 },
      zIndex: 2,
    },
    {
      asset: "frame/f_bot_left.png",
      bounds: { x: 0, bottom: 77, w: 77, h: 77 },
      zIndex: 2,
    },
    {
      asset: "frame/f_inner_top.png",
      bounds: { x: 77, y: 24, w: 153, h: 36 },
      zIndex: 2,
    },
    {
      asset: "frame/f_top_s_2.png",
      bounds: { right: 163, y: 24, w: 86, h: 36 },
      zIndex: 2,
    },
    {
      asset: "frame/f_bot_center.png",
      bounds: { x: 77, bottom: 60, w: 153, h: 47 },
      zIndex: 2,
    },
    {
      asset: "frame/f_bot_s_2.png",
      bounds: { right: 163, bottom: 60, w: 86, h: 47 },
      zIndex: 2,
    },
    {
      asset: "frame/f_inner_left.png",
      bounds: { x: 24, y: 77, w: 36, h: 100 },
      zIndex: 2,
    },
    {
      asset: "frame/f_inner_left2.png",
      bounds: { x: 24, bottom: 133, w: 36, h: 56 },
      zIndex: 2,
    },
    {
      asset: "frame/f_inner_right.png",
      bounds: { right: 60, y: 77, w: 36, h: 100 },
      zIndex: 2,
    },
    {
      asset: "frame/f_inner_right2.png",
      bounds: { right: 60, bottom: 133, w: 36, h: 56 },
      zIndex: 2,
    },
    {
      asset: "frame/f_bot_right.png",
      bounds: { right: 77, bottom: 77, w: 77, h: 77 },
      zIndex: 2,
    },
  ],
};

describe("computeExplicitTiledFrameRects", () => {
  it("matches WMS plBox layout at default size", () => {
    const rects = computeExplicitTiledFrameRects(448, 316, xboxExplicitPresentation.tiles);
    expect(rects.find((r) => r.asset === "frame/f_top_center.png")).toMatchObject({
      x: 65,
      y: 0,
      w: 318,
      h: 24,
      tiled: "horizontal",
    });
    expect(rects.find((r) => r.asset === "frame/f_inner_top.png")).toMatchObject({
      x: 77,
      y: 24,
      w: 153,
      h: 36,
      zIndex: 2,
    });
    expect(rects.find((r) => r.asset === "frame/f_top_s.png")).toMatchObject({
      x: 230,
      y: 24,
      w: 55,
      h: 36,
      tiled: "horizontal",
    });
    expect(rects.find((r) => r.asset === "frame/f_inner_left_s.png")).toMatchObject({
      x: 24,
      y: 177,
      w: 36,
      h: 6,
      tiled: "vertical",
    });
  });

  it("routes explicit tiles through computeTiledFrameLayoutRects", () => {
    const rects = computeTiledFrameLayoutRects(448, 316, xboxExplicitPresentation);
    expect(rects.some((r) => r.asset === "frame/f_outer_bot.png")).toBe(true);
  });
});
