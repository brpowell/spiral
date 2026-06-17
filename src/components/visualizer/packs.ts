import type { SceneLayer } from "./scene/types";
import type {
  VisualizerPack,
  VisualizerSurface,
  VisualizerSurfaceProfile,
} from "./types";

const BARS_SCENE: VisualizerSurfaceProfile = {
  scene: [
    {
      kind: "canvas",
      layout: "fill",
      renderer: "bars",
      params: { barCount: 64 },
    },
  ],
};

/** Inline fallback when the default bars pack cannot be loaded from disk. */
export const BARS_FALLBACK_PACK: VisualizerPack = {
  id: "bars",
  surfaces: {
    mini: BARS_SCENE,
    panel: BARS_SCENE,
    expanded: BARS_SCENE,
  },
};

export function resolveSurfaceScene(
  pack: VisualizerPack,
  surface: VisualizerSurface,
  reducedMotion = false,
): SceneLayer[] {
  if (reducedMotion && pack.reducedSurfaces) {
    const reduced =
      pack.reducedSurfaces[surface] ?? pack.reducedSurfaces.default;
    if (reduced) return reduced.scene;
  }
  return pack.surfaces[surface].scene;
}
