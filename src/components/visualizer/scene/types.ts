import type { LayerDriveMap } from "../../../lib/presentation/types";

export type VizSceneLayerKind = "canvas" | "webgl" | "image" | "video";

export type VizSceneLayout =
  "fill" | { x: number; y: number; w: number; h: number };

/** One layer in a VizScene (canvas/webgl/media). */
export interface VizSceneLayer {
  id?: string;
  kind: VizSceneLayerKind;
  layout: VizSceneLayout;
  blend?: string;
  drive?: LayerDriveMap;
  opacity?: number;
  scale?: number;
  translateX?: number;
  translateY?: number;
  rotation?: number;
  /** JS module path relative to the visualizer contribution folder. */
  entry?: string;
  asset?: string;
  loop?: boolean;
}

/** Layer list for a visualizer (`viz.json` `children`). */
export type VizScene = VizSceneLayer[];

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function resolveLayout(
  layout: VizSceneLayout,
  width: number,
  height: number,
): LayoutRect {
  if (layout === "fill") {
    return { x: 0, y: 0, w: width, h: height };
  }

  return {
    x: layout.x * width,
    y: layout.y * height,
    w: layout.w * width,
    h: layout.h * height,
  };
}
