import type { VizScene } from "./scene/types";
import type {
  Visualizer,
  VisualizerSurfaceProfile,
} from "./types";

const BARS_SCENE: VisualizerSurfaceProfile = {
  scene: [
    {
      kind: "canvas",
      layout: "fill",
      renderer: "spiral.core.renderer.bars",
      params: { barCount: 64 },
    },
  ],
};

/** Inline fallback when the default bars visualizer cannot be loaded from disk. */
export const BARS_FALLBACK_VISUALIZER: Visualizer = {
  id: "spiral.core.visualizer.bars",
  surfaces: {
    default: BARS_SCENE,
  },
};

export function resolveSurfaceScene(visualizer: Visualizer): VizScene {
  return visualizer.surfaces.default.scene;
}
