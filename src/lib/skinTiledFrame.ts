import type {
  TiledFrameContentInset,
  TiledFramePresentation,
} from "../types/skin";

/** WMP paint order: stretch bands, then content, then chrome caps and grip. */
export type FrameRectLayer = "stretchSecondary" | "stretch" | "chrome" | "grip";

export const TILED_FRAME_CONTENT_Z = 1;

const FRAME_LAYER_Z: Record<FrameRectLayer, number> = {
  stretchSecondary: 0,
  stretch: 0,
  chrome: 2,
  grip: 3,
};

export function frameRectZIndex(layer: FrameRectLayer): number {
  return FRAME_LAYER_Z[layer];
}

export interface FrameRect {
  asset: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tiled: "horizontal" | "vertical" | false;
  layer: FrameRectLayer;
  /** Source tile dimensions for repeat-x / repeat-y (defaults to w × h). */
  tileUnitW?: number;
  tileUnitH?: number;
}

export function partitionTiledFrameRects(rects: FrameRect[]): {
  stretchTiles: FrameRect[];
  chromeTiles: FrameRect[];
} {
  const stretchTiles: FrameRect[] = [];
  const chromeTiles: FrameRect[] = [];
  for (const rect of rects) {
    if (rect.layer === "stretch" || rect.layer === "stretchSecondary") {
      stretchTiles.push(rect);
    } else {
      chromeTiles.push(rect);
    }
  }
  return { stretchTiles, chromeTiles };
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

/**
 * WMP plView-style 9-slice frame tile layout.
 * Stretch widths follow `checkPlViewSize`: top = floor(w/2)+10, bottom = floor(w/2).
 */
export function computeTiledFrameRects(
  windowW: number,
  windowH: number,
  presentation: TiledFramePresentation,
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

  // f_top_s_2: left top tiled band (after top-left corner, up to center.left).
  const topStretch2X = tileSizes.topLeft.w;
  const topStretch2W = Math.max(0, topCenterX - topStretch2X);

  // f_top_s (plTopStretch): right top tiled band from center.left, width from checkPlViewSize.
  const topStretchX = topCenterX;

  // f_bot_s_2: left bottom tiled band (after bottom-left corner, up to center.left).
  const bottomStretch2X = tileSizes.bottomLeft.w;
  const bottomStretch2W = Math.max(0, bottomCenterX - bottomStretch2X);

  // f_bot_s (plBotStretch): right bottom tiled band from center.left.
  const bottomStretchX = bottomCenterX;

  const rects: FrameRect[] = [
    {
      asset: assets.topStretch,
      x: topStretchX,
      y: 0,
      w: topStretchW,
      h: t,
      tiled: "horizontal",
      layer: "stretch",
      tileUnitW: tileSizes.topStretch?.w,
      tileUnitH: computeStretchTileUnitH(t, tileSizes.topStretch ?? { h: t }),
    },
    {
      asset: assets.leftStretch,
      x: 0,
      y: t,
      w: tileSizes.leftStretch?.w ?? tileSizes.topLeft.w,
      h: sideStretchH,
      tiled: "vertical",
      layer: "stretch",
      tileUnitW: tileSizes.leftStretch?.w ?? tileSizes.topLeft.w,
      tileUnitH: tileSizes.leftStretch?.h,
    },
    {
      asset: assets.rightStretch,
      x: rightStretchX,
      y: t,
      w: tileSizes.rightStretch?.w ?? tileSizes.topRight.w,
      h: sideStretchH,
      tiled: "vertical",
      layer: "stretch",
      tileUnitW: tileSizes.rightStretch?.w ?? tileSizes.topRight.w,
      tileUnitH: tileSizes.rightStretch?.h,
    },
    {
      asset: assets.bottomStretch,
      x: bottomStretchX,
      y: bottomY,
      w: bottomStretchW,
      h: t,
      tiled: "horizontal",
      layer: "stretch",
      tileUnitW: tileSizes.bottomStretch?.w,
      tileUnitH: t,
    },
    {
      asset: assets.topLeft,
      x: 0,
      y: 0,
      w: tileSizes.topLeft.w,
      h: tileSizes.topLeft.h,
      tiled: false,
      layer: "chrome",
    },
    {
      asset: assets.topCenter,
      x: topCenterX,
      y: 0,
      w: tileSizes.topCenter.w,
      h: tileSizes.topCenter.h,
      tiled: false,
      layer: "chrome",
    },
    {
      asset: assets.topRight,
      x: topRightX,
      y: 0,
      w: tileSizes.topRight.w,
      h: tileSizes.topRight.h,
      tiled: false,
      layer: "chrome",
    },
    {
      asset: assets.bottomLeft,
      x: 0,
      y: bottomY,
      w: tileSizes.bottomLeft.w,
      h: tileSizes.bottomLeft.h,
      tiled: false,
      layer: "chrome",
    },
    {
      asset: assets.bottomCenter,
      x: bottomCenterX,
      y: bottomY,
      w: tileSizes.bottomCenter.w,
      h: tileSizes.bottomCenter.h,
      tiled: false,
      layer: "chrome",
    },
    {
      asset: assets.bottomRight,
      x: bottomRightX,
      y: bottomY,
      w: tileSizes.bottomRight.w,
      h: tileSizes.bottomRight.h,
      tiled: false,
      layer: "chrome",
    },
  ];

  if (assets.topStretch2 && tileSizes.topStretch2) {
    rects.push({
      asset: assets.topStretch2,
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
    rects.push({
      asset: assets.bottomStretch2,
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
    rects.push({
      asset: assets.resizeGrip,
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
