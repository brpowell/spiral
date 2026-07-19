import type { LayerDriveMap } from "../../../lib/presentation/types";
import type { VizRendererRef } from "../../../types/visualizer";

export type VizSceneLayerKind =
  | "canvas"
  | "webgl"
  | "image"
  | "video"
  | "group";

export type VizSceneLayout =
  | "fill"
  | { x: number; y: number; w: number; h: number };

/** One layer in a VizScene (canvas/webgl/media/group). */
export interface VizSceneLayer {
  id?: string;
  kind: VizSceneLayerKind;
  layout: VizSceneLayout;
  visibleWhen?: string;
  blend?: string;
  drive?: LayerDriveMap;
  opacity?: number;
  scale?: number;
  translateX?: number;
  translateY?: number;
  rotation?: number;
  /** Fully-qualified renderer contribution id (`authorId.packId.renderer.id`). */
  renderer?: VizRendererRef;
  params?: Record<string, unknown>;
  asset?: string;
  loop?: boolean;
  children?: VizSceneLayer[];
}

/** Layer tree for one visualizer surface. */
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
