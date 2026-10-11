import { describe, expect, it } from "vitest";
import { resolveLocalBounds } from "./skinLayout";
import {
  computeChromeClipPath,
  computeContentRect,
  computeExplicitTiledFrameRects,
  computeStretchTileUnitH,
  computeTiledFrameLayoutRects,
  computeTiledFramePresetRects,
  partitionTiledFrameRects,
  computeTilePaintSlices,
  tiledFrameChromeShouldClip,
  tiledFrameContentRadius,
  tiledFrameTilesStackWithSiblings,
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

describe("resolveLocalBounds (tiled frame / stretch)", () => {
  it("resolves fixed left bounds", () => {
    expect(
      resolveLocalBounds(
        { x: 77, y: 24, w: 153, h: 36 },
        { width: 448, height: 316 },
      ),
    ).toEqual({
      x: 77,
      y: 24,
      w: 153,
      h: 36,
      zIndex: undefined,
    });
  });

  it("resolves horizontal stretch from x and right insets", () => {
    expect(
      resolveLocalBounds(
        { x: 230, right: 163, y: 24, h: 36 },
        { width: 448, height: 316 },
      ),
    ).toEqual({
      x: 230,
      y: 24,
      w: 55,
      h: 36,
      zIndex: undefined,
    });
  });

  it("resolves vertical stretch from y and bottom insets", () => {
    expect(
      resolveLocalBounds(
        { x: 24, y: 177, w: 36, bottom: 133 },
        { width: 448, height: 316 },
      ),
    ).toEqual({
      x: 24,
      y: 177,
      w: 36,
      h: 6,
      zIndex: undefined,
    });
  });

  it("resolves bottom-anchored fixed caps", () => {
    expect(
      resolveLocalBounds(
        { x: 0, bottom: 0, w: 77, h: 77 },
        { width: 448, height: 316 },
      ),
    ).toEqual({
      x: 0,
      y: 239,
      w: 77,
      h: 77,
      zIndex: undefined,
    });
  });

  it("resolves right-anchored fixed caps", () => {
    expect(
      resolveLocalBounds(
        { right: 77, y: 24, w: 86, h: 36 },
        { width: 448, height: 316 },
      ),
    ).toEqual({
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
    const { underContentTiles, overContentTiles } =
      partitionTiledFrameRects(rects);
    expect(underContentTiles.length).toBeGreaterThan(0);
    expect(overContentTiles.length).toBeGreaterThan(0);
    expect(
      underContentTiles.every((t) => t.zIndex < TILED_FRAME_CONTENT_Z),
    ).toBe(true);
    expect(
      overContentTiles.every((t) => t.zIndex > TILED_FRAME_CONTENT_Z),
    ).toBe(true);
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

  it("does not clip when contentInset is zero", () => {
    expect(
      tiledFrameChromeShouldClip({ left: 0, top: 0, right: 0, bottom: 0 }),
    ).toBe(false);
    expect(
      tiledFrameChromeShouldClip({ left: 16, top: 42, right: 16, bottom: 37 }),
    ).toBe(true);
  });

  it("stacks zero-inset tiles with canvas siblings", () => {
    expect(
      tiledFrameTilesStackWithSiblings({
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
      }),
    ).toBe(true);
    expect(
      tiledFrameTilesStackWithSiblings({
        left: 16,
        top: 42,
        right: 16,
        bottom: 37,
      }),
    ).toBe(false);
  });

  it("rounds the chrome hole from presentation.contentCornerRadius", () => {
    const inset = { left: 16, top: 42, right: 16, bottom: 37 };
    const presentation: TiledFrameExplicitPresentation = {
      kind: "tiledFrame",
      contentInset: inset,
      tiles: [],
      contentCornerRadius: 8,
    };
    expect(tiledFrameContentRadius(presentation)).toBe(8);
    expect(
      tiledFrameContentRadius({
        ...presentation,
        contentCornerRadius: undefined,
      }),
    ).toBe(0);
    const path = computeChromeClipPath(
      376,
      216,
      computeContentRect(376, 216, inset),
      tiledFrameContentRadius(presentation),
    );
    expect(path.startsWith("polygon(evenodd,0px 0px, 376px 0px")).toBe(true);
    expect(path).not.toContain("16px 42px");
    expect(path).toContain("24px 42px");
    expect(path).toContain("16px 50px");
  });
});

const lostPlanetAuxTiles: TiledFrameExplicitPresentation["tiles"] = [
  {
    asset: "frame/f-top-left.png",
    bounds: { x: 0, y: 0, w: 178, h: 104, zIndex: 5 },
    zIndex: 5,
  },
  {
    asset: "frame/f-top-right.png",
    bounds: { y: 0, h: 104, right: 0, w: 178, zIndex: 5 },
    zIndex: 5,
  },
  {
    asset: "frame/f-top-tile.png",
    bounds: { x: 178, y: 0, h: 38, right: 0, zIndex: 6 },
    repeat: "horizontal",
    tileUnit: { w: 138, h: 38 },
    zIndex: 6,
  },
  {
    asset: "frame/f-top-tile2.png",
    bounds: { x: 178, y: 0, h: 104, right: 178, zIndex: 4 },
    repeat: "horizontal",
    tileUnit: { w: 20, h: 104 },
    zIndex: 4,
  },
];

describe("computeTilePaintSlices", () => {
  it("masks the f-top-tile glaze with f-top-right where they overlap", () => {
    const rects = computeExplicitTiledFrameRects(437, 304, lostPlanetAuxTiles);
    const overlay = rects.find((r) => r.asset === "frame/f-top-tile.png");
    expect(overlay).toMatchObject({ x: 178, y: 0, w: 259, h: 38 });
    const slices = computeTilePaintSlices(overlay!, rects);
    expect(slices).toHaveLength(2);
    expect(slices.find((s) => !s.maskCap)).toMatchObject({
      x: 178,
      y: 0,
      w: 81,
      h: 38,
    });
    expect(slices.find((s) => s.maskCap)).toMatchObject({
      x: 259,
      y: 0,
      w: 178,
      h: 38,
      maskCap: expect.objectContaining({ asset: "frame/f-top-right.png" }),
    });
  });

  it("masks the glaze overlap when the window is wider", () => {
    const rects = computeExplicitTiledFrameRects(565, 310, lostPlanetAuxTiles);
    const overlay = rects.find((r) => r.asset === "frame/f-top-tile.png")!;
    const masked = computeTilePaintSlices(overlay, rects).find(
      (s) => s.maskCap,
    );
    expect(masked).toMatchObject({
      x: 387,
      y: 0,
      w: 178,
      h: 38,
      maskCap: expect.objectContaining({ asset: "frame/f-top-right.png" }),
    });
  });

  it("does not split Xbox-style frames whose stretch stops at the caps", () => {
    const rects = computeExplicitTiledFrameRects(
      448,
      316,
      xboxExplicitPresentation.tiles,
    );
    const stretch = rects.find((r) => r.asset === "frame/f_top_center.png")!;
    const slices = computeTilePaintSlices(stretch, rects);
    expect(slices).toHaveLength(1);
    expect(slices[0]?.maskCap).toBeUndefined();
    expect(slices[0]).toMatchObject({ x: 65, y: 0, w: 318, h: 24 });
  });

  it("does not mask under-tiles that sit below the cap", () => {
    const rects = computeExplicitTiledFrameRects(437, 304, lostPlanetAuxTiles);
    const under = rects.find((r) => r.asset === "frame/f-top-tile2.png")!;
    const slices = computeTilePaintSlices(under, rects);
    expect(slices).toHaveLength(1);
    expect(slices[0]?.maskCap).toBeUndefined();
  });

  it("masks both ends when a glaze spans two caps", () => {
    const rects = computeExplicitTiledFrameRects(437, 304, [
      lostPlanetAuxTiles[0],
      lostPlanetAuxTiles[1],
      {
        ...lostPlanetAuxTiles[2],
        bounds: { x: 0, y: 0, h: 38, right: 0, zIndex: 6 },
      },
    ]);
    const overlay = rects.find((r) => r.asset === "frame/f-top-tile.png")!;
    const slices = computeTilePaintSlices(overlay, rects);
    const masked = slices.filter((s) => s.maskCap).map((s) => s.maskCap?.asset);
    expect(masked).toEqual(
      expect.arrayContaining(["frame/f-top-left.png", "frame/f-top-right.png"]),
    );
    expect(slices.find((s) => !s.maskCap)).toMatchObject({
      x: 178,
      y: 0,
      w: 81,
      h: 38,
    });
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
      bounds: { x: 65, right: 65, bottom: 0, h: 24 },
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
      bounds: { right: 0, y: 65, w: 24, bottom: 77 },
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
      bounds: { x: 230, right: 163, bottom: 13, h: 47 },
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
      bounds: { right: 24, y: 177, w: 36, bottom: 133 },
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
      bounds: { right: 0, y: 0, w: 77, h: 77 },
      zIndex: 2,
    },
    {
      asset: "frame/f_bot_left.png",
      bounds: { x: 0, bottom: 0, w: 77, h: 77 },
      zIndex: 2,
    },
    {
      asset: "frame/f_inner_top.png",
      bounds: { x: 77, y: 24, w: 153, h: 36 },
      zIndex: 2,
    },
    {
      asset: "frame/f_top_s_2.png",
      bounds: { right: 77, y: 24, w: 86, h: 36 },
      zIndex: 2,
    },
    {
      asset: "frame/f_bot_center.png",
      bounds: { x: 77, bottom: 13, w: 153, h: 47 },
      zIndex: 2,
    },
    {
      asset: "frame/f_bot_s_2.png",
      bounds: { right: 77, bottom: 13, w: 86, h: 47 },
      zIndex: 2,
    },
    {
      asset: "frame/f_inner_left.png",
      bounds: { x: 24, y: 77, w: 36, h: 100 },
      zIndex: 2,
    },
    {
      asset: "frame/f_inner_left2.png",
      bounds: { x: 24, bottom: 77, w: 36, h: 56 },
      zIndex: 2,
    },
    {
      asset: "frame/f_inner_right.png",
      bounds: { right: 24, y: 77, w: 36, h: 100 },
      zIndex: 2,
    },
    {
      asset: "frame/f_inner_right2.png",
      bounds: { right: 24, bottom: 77, w: 36, h: 56 },
      zIndex: 2,
    },
    {
      asset: "frame/f_bot_right.png",
      bounds: { right: 0, bottom: 0, w: 77, h: 77 },
      zIndex: 2,
    },
  ],
};

describe("computeExplicitTiledFrameRects", () => {
  it("matches WMS plBox layout at default size", () => {
    const rects = computeExplicitTiledFrameRects(
      448,
      316,
      xboxExplicitPresentation.tiles,
    );
    expect(
      rects.find((r) => r.asset === "frame/f_top_center.png"),
    ).toMatchObject({
      x: 65,
      y: 0,
      w: 318,
      h: 24,
      tiled: "horizontal",
    });
    expect(
      rects.find((r) => r.asset === "frame/f_inner_top.png"),
    ).toMatchObject({
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
    expect(
      rects.find((r) => r.asset === "frame/f_inner_left_s.png"),
    ).toMatchObject({
      x: 24,
      y: 177,
      w: 36,
      h: 6,
      tiled: "vertical",
    });
  });

  it("routes explicit tiles through computeTiledFrameLayoutRects", () => {
    const rects = computeTiledFrameLayoutRects(
      448,
      316,
      xboxExplicitPresentation,
    );
    expect(rects.some((r) => r.asset === "frame/f_outer_bot.png")).toBe(true);
  });

  it("meets Lost Planet vis-top-right when vis-top-tile uses right: 127", () => {
    const rects = computeExplicitTiledFrameRects(376, 216, [
      {
        asset: "decorations/vis-top-tile.png",
        bounds: { x: 246, y: 43, h: 66, right: 127, zIndex: 40 },
        repeat: "horizontal",
        tileUnit: { w: 100, h: 66 },
        zIndex: 40,
      },
      {
        asset: "frame/vis-top-right.png",
        bounds: { y: 43, h: 110, right: 19, w: 108, zIndex: 41 },
        zIndex: 41,
      },
    ]);
    const tile = rects.find((r) => r.asset === "decorations/vis-top-tile.png");
    const corner = rects.find((r) => r.asset === "frame/vis-top-right.png");
    expect(tile).toMatchObject({ x: 246, y: 43, w: 3, h: 66 });
    expect(corner).toMatchObject({ x: 249, y: 43, w: 108 });
    expect((tile?.x ?? 0) + (tile?.w ?? 0)).toBe(corner?.x);
  });
});
