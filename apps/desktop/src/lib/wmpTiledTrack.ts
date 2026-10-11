import type { CSSProperties } from "react";

export interface WmpTiledTrackParams {
  trackUrl: string;
  trackTileWidth: number;
  trackTileHeight: number;
  trackWidth: number;
  trackHeight: number;
  borderSize: number;
  direction?: "vertical" | "horizontal";
}

/** True when the tile is smaller than the control and borderSize enables WMP 3-slice tiling. */
export function wmpTiledTrackUsesSlicing({
  trackTileWidth,
  trackTileHeight,
  trackWidth,
  trackHeight,
  borderSize,
  direction = "vertical",
}: Omit<WmpTiledTrackParams, "trackUrl">): boolean {
  if (borderSize <= 0) return false;

  const tileSpan = direction === "vertical" ? trackTileHeight : trackTileWidth;
  const trackSpan = direction === "vertical" ? trackHeight : trackWidth;
  if (tileSpan >= trackSpan) return false;

  const middleSlice = tileSpan - borderSize * 2;
  return middleSlice > 0;
}

/**
 * WMP SLIDER.tiled + borderSize track rendering.
 * End caps are fixed; the middle slice of the source tile repeats along the slider axis.
 */
export function wmpTiledTrackStyle({
  trackUrl,
  trackTileWidth,
  trackTileHeight,
  trackWidth,
  trackHeight,
  borderSize,
  direction = "vertical",
}: WmpTiledTrackParams): CSSProperties {
  const usesSlicing = wmpTiledTrackUsesSlicing({
    trackTileWidth,
    trackTileHeight,
    trackWidth,
    trackHeight,
    borderSize,
    direction,
  });

  if (!usesSlicing) {
    return {
      width: `${trackWidth}px`,
      height: `${trackHeight}px`,
      backgroundImage: `url("${trackUrl}")`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
      backgroundSize: `${trackWidth}px ${trackHeight}px`,
    };
  }

  if (direction === "vertical") {
    return {
      boxSizing: "border-box",
      width: `${trackWidth}px`,
      height: `${trackHeight}px`,
      borderStyle: "solid",
      borderColor: "transparent",
      borderWidth: `${borderSize}px 0`,
      borderImageSource: `url("${trackUrl}")`,
      borderImageSlice: `${borderSize} 0 ${borderSize} 0 fill`,
      borderImageWidth: `${borderSize}px 0 ${borderSize}px 0`,
      borderImageRepeat: "stretch repeat",
      background: "none",
    };
  }

  return {
    boxSizing: "border-box",
    width: `${trackWidth}px`,
    height: `${trackHeight}px`,
    borderStyle: "solid",
    borderColor: "transparent",
    borderWidth: `0 ${borderSize}px`,
    borderImageSource: `url("${trackUrl}")`,
    borderImageSlice: `0 ${borderSize} 0 ${borderSize} fill`,
    borderImageWidth: `0 ${borderSize}px 0 ${borderSize}px`,
    borderImageRepeat: "repeat stretch",
    background: "none",
  };
}
