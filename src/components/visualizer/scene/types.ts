import type { LayerDriveMap } from "../../../lib/presentation/types";
import type { VisualizerRendererId, WebGLRendererId } from "../types";

export type SceneLayerKind = "canvas" | "webgl" | "image" | "gif" | "video" | "group";

export type SceneAnchor = "center" | "top" | "bottom" | "left" | "right";

export type SceneLayout =
  | "fill"
  | { x: number; y: number; w: number; h: number }
  | { anchor: SceneAnchor; w: number; h: number };

export interface SceneLayer {
  id?: string;
  kind: SceneLayerKind;
  layout: SceneLayout;
  layoutParams?: Record<string, number>;
  visibleWhen?: string;
  blend?: string;
  drive?: LayerDriveMap;
  opacity?: number;
  scale?: number;
  translateX?: number;
  translateY?: number;
  rotation?: number;
  renderer?: VisualizerRendererId | WebGLRendererId;
  params?: Record<string, unknown>;
  asset?: string;
  loop?: boolean;
  children?: SceneLayer[];
}

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function resolveLayout(
  layout: SceneLayout,
  width: number,
  height: number,
): LayoutRect {
  if (layout === "fill") {
    return { x: 0, y: 0, w: width, h: height };
  }

  if ("x" in layout) {
    return {
      x: layout.x * width,
      y: layout.y * height,
      w: layout.w * width,
      h: layout.h * height,
    };
  }

  const w = layout.w * width;
  const h = layout.h * height;
  let x = (width - w) / 2;
  let y = (height - h) / 2;

  switch (layout.anchor) {
    case "top":
      y = 0;
      break;
    case "bottom":
      y = height - h;
      break;
    case "left":
      x = 0;
      y = (height - h) / 2;
      break;
    case "right":
      x = width - w;
      y = (height - h) / 2;
      break;
    default:
      break;
  }

  return { x, y, w, h };
}
