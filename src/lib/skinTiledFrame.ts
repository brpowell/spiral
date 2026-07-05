import { resolveStretchBounds } from "./skinPanels";
import type {
  TiledFrameContentInset,
  TiledFramePresentation,
  TiledFramePresetPresentation,
  TiledFrameTileDef,
} from "../types/skin";
import { isTiledFrameExplicit } from "../types/skin";

export const TILED_FRAME_CONTENT_Z = 1;

export interface FrameRect {
  asset: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tiled: "horizontal" | "vertical" | false;
  zIndex: number;
  /** Stable manifest order for React keys across resize. */
  tileIndex: number;
  /** Source tile dimensions for repeat-x / repeat-y (defaults to w × h). */
  tileUnitW?: number;
  tileUnitH?: number;
}

export function partitionTiledFrameRects(rects: FrameRect[]): {
  underContentTiles: FrameRect[];
  overContentTiles: FrameRect[];
} {
  const underContentTiles: FrameRect[] = [];
  const overContentTiles: FrameRect[] = [];
  for (const rect of rects) {
    if (rect.zIndex < TILED_FRAME_CONTENT_Z) {
      underContentTiles.push(rect);
    } else {
      overContentTiles.push(rect);
    }
  }
  return { underContentTiles, overContentTiles };
}

/** Scale a tall source tile so its art band fills the display band (WMP top/bottom stretch). */
export function computeStretchTileUnitH(
  displayH: number,
  source: { h: number; artHeight?: number },
): number {
  const { h: sourceH, artHeight } = source;
  if (artHeight != null && artHeight > 0 && sourceH > artHeight) {
    return (sourceH * displayH) / artHeight;
  }
  return displayH;
}

export function computeContentRect(
  windowW: number,
  windowH: number,
  inset: TiledFrameContentInset,
): { x: number; y: number; w: number; h: number } {
  const w = Math.max(0, windowW - inset.left - inset.right);
  const h = Math.max(0, windowH - inset.top - inset.bottom);
  return { x: inset.left, y: inset.top, w, h };
}

/** Clip chrome caps so opaque inner fill in WMP tiles cannot paint over the content rect. */
export function computeChromeClipPath(
  windowW: number,
  windowH: number,
  contentRect: { x: number; y: number; w: number; h: number },
): string {
  const l = contentRect.x;
  const t = contentRect.y;
  const r = contentRect.x + contentRect.w;
  const b = contentRect.y + contentRect.h;
  return (
    `polygon(evenodd,` +
    `0px 0px, ${windowW}px 0px, ${windowW}px ${windowH}px, 0px ${windowH}px, 0px 0px,` +
    `${l}px ${t}px, ${r}px ${t}px, ${r}px ${b}px, ${l}px ${b}px, ${l}px ${t}px)`
  );
}

function presetZIndex(layer: "stretchSecondary" | "stretch" | "chrome" | "grip"): number {
  if (layer === "stretchSecondary" || layer === "stretch") return 0;
  if (layer === "chrome") return 2;
  return 3;
}

/**
 * WMP plView-style 9-slice frame tile layout.
 * Stretch widths follow `checkPlViewSize`: top = floor(w/2)+10, bottom = floor(w/2).
 */
export function computeTiledFramePresetRects(
  windowW: number,
  windowH: number,
  presentation: TiledFramePresetPresentation,
): FrameRect[] {
  const { assets, tileSizes, frameThickness } = presentation;
  const t = frameThickness;
  const bottomY = windowH - t;

  const topCenterX = Math.floor((windowW - tileSizes.topCenter.w) / 2);
  const bottomCenterX = Math.floor((windowW - tileSizes.bottomCenter.w) / 2);

  const topStretchW = Math.floor(windowW / 2) + 10;
  const bottomStretchW = Math.floor(windowW / 2);

  const topRightX = windowW - tileSizes.topRight.w;
  const bottomRightX = windowW - tileSizes.bottomRight.w;
  const rightStretchX = windowW - tileSizes.topRight.w;

  const sideStretchH = Math.max(0, windowH - t * 2);

  const topStretch2X = tileSizes.topLeft.w;
  const topStretch2W = Math.max(0, topCenterX - topStretch2X);

  const topStretchX = topCenterX;

  const bottomStretch2X = tileSizes.bottomLeft.w;
  const bottomStretch2W = Math.max(0, bottomCenterX - bottomStretch2X);

  const bottomStretchX = bottomCenterX;

  type Layer = "stretchSecondary" | "stretch" | "chrome" | "grip";

  const push = (
    rects: FrameRect[],
    asset: string,
    rect: Omit<FrameRect, "asset" | "zIndex" | "tileIndex"> & { layer: Layer },
  ) => {
    const { layer, ...rest } = rect;
    rects.push({
      asset,
      ...rest,
      zIndex: presetZIndex(layer),
      tileIndex: rects.length,
    });
  };

  const rects: FrameRect[] = [];

  push(rects, assets.topStretch, {
    x: topStretchX,
    y: 0,
    w: topStretchW,
    h: t,
    tiled: "horizontal",
    layer: "stretch",
    tileUnitW: tileSizes.topStretch?.w,
    tileUnitH: computeStretchTileUnitH(t, tileSizes.topStretch ?? { h: t }),
  });
  push(rects, assets.leftStretch, {
    x: 0,
    y: t,
    w: tileSizes.leftStretch?.w ?? tileSizes.topLeft.w,
    h: sideStretchH,
    tiled: "vertical",
    layer: "stretch",
    tileUnitW: tileSizes.leftStretch?.w ?? tileSizes.topLeft.w,
    tileUnitH: tileSizes.leftStretch?.h,
  });
  push(rects, assets.rightStretch, {
    x: rightStretchX,
    y: t,
    w: tileSizes.rightStretch?.w ?? tileSizes.topRight.w,
    h: sideStretchH,
    tiled: "vertical",
    layer: "stretch",
    tileUnitW: tileSizes.rightStretch?.w ?? tileSizes.topRight.w,
    tileUnitH: tileSizes.rightStretch?.h,
  });
  push(rects, assets.bottomStretch, {
    x: bottomStretchX,
    y: bottomY,
    w: bottomStretchW,
    h: t,
    tiled: "horizontal",
    layer: "stretch",
    tileUnitW: tileSizes.bottomStretch?.w,
    tileUnitH: t,
  });
  push(rects, assets.topLeft, {
    x: 0,
    y: 0,
    w: tileSizes.topLeft.w,
    h: tileSizes.topLeft.h,
    tiled: false,
    layer: "chrome",
  });
  push(rects, assets.topCenter, {
    x: topCenterX,
    y: 0,
    w: tileSizes.topCenter.w,
    h: tileSizes.topCenter.h,
    tiled: false,
    layer: "chrome",
  });
  push(rects, assets.topRight, {
    x: topRightX,
    y: 0,
    w: tileSizes.topRight.w,
    h: tileSizes.topRight.h,
    tiled: false,
    layer: "chrome",
  });
  push(rects, assets.bottomLeft, {
    x: 0,
    y: bottomY,
    w: tileSizes.bottomLeft.w,
    h: tileSizes.bottomLeft.h,
    tiled: false,
    layer: "chrome",
  });
  push(rects, assets.bottomCenter, {
    x: bottomCenterX,
    y: bottomY,
    w: tileSizes.bottomCenter.w,
    h: tileSizes.bottomCenter.h,
    tiled: false,
    layer: "chrome",
  });
  push(rects, assets.bottomRight, {
    x: bottomRightX,
    y: bottomY,
    w: tileSizes.bottomRight.w,
    h: tileSizes.bottomRight.h,
    tiled: false,
    layer: "chrome",
  });

  if (assets.topStretch2 && tileSizes.topStretch2) {
    push(rects, assets.topStretch2, {
      x: topStretch2X,
      y: 0,
      w: topStretch2W,
      h: t,
      tiled: "horizontal",
      layer: "stretchSecondary",
      tileUnitW: tileSizes.topStretch2.w,
      tileUnitH: computeStretchTileUnitH(t, tileSizes.topStretch2),
    });
  }

  if (assets.bottomStretch2 && tileSizes.bottomStretch2) {
    push(rects, assets.bottomStretch2, {
      x: bottomStretch2X,
      y: bottomY,
      w: bottomStretch2W,
      h: t,
      tiled: "horizontal",
      layer: "stretchSecondary",
      tileUnitW: tileSizes.bottomStretch2.w,
      tileUnitH: t,
    });
  }

  if (assets.resizeGrip && tileSizes.resizeGrip) {
    push(rects, assets.resizeGrip, {
      x: windowW - tileSizes.resizeGrip.w,
      y: windowH - tileSizes.resizeGrip.h,
      w: tileSizes.resizeGrip.w,
      h: tileSizes.resizeGrip.h,
      tiled: false,
      layer: "grip",
    });
  }

  return rects;
}

export function computeExplicitTiledFrameRects(
  windowW: number,
  windowH: number,
  tiles: TiledFrameTileDef[],
): FrameRect[] {
  return tiles.map((tile, tileIndex) => {
    const resolved = resolveStretchBounds(tile.bounds, windowW, windowH);
    const tiled =
      tile.repeat === "horizontal"
        ? "horizontal"
        : tile.repeat === "vertical"
          ? "vertical"
          : false;
    const defaultZ = tile.repeat ? 0 : 2;
    const zIndex = tile.zIndex ?? tile.bounds.zIndex ?? defaultZ;
    let tileUnitH = tile.tileUnit?.h ?? resolved.h;
    if (tile.artHeight != null && tile.tileUnit) {
      tileUnitH = computeStretchTileUnitH(resolved.h, {
        h: tile.tileUnit.h,
        artHeight: tile.artHeight,
      });
    }
    return {
      asset: tile.asset,
      x: resolved.x,
      y: resolved.y,
      w: resolved.w,
      h: resolved.h,
      tiled,
      zIndex,
      tileIndex,
      tileUnitW: tile.tileUnit?.w,
      tileUnitH,
    };
  });
}

export function computeTiledFrameLayoutRects(
  windowW: number,
  windowH: number,
  presentation: TiledFramePresentation,
): FrameRect[] {
  if (isTiledFrameExplicit(presentation)) {
    return computeExplicitTiledFrameRects(windowW, windowH, presentation.tiles);
  }
  return computeTiledFramePresetRects(windowW, windowH, presentation);
}
