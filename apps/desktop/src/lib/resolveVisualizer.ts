import type { SkinVisualizer } from "../types/skin";
import type { LoadedVisualizer, VizManifest } from "../types/visualizer";
import type { Visualizer } from "../components/visualizer/types";

export const DEFAULT_VISUALIZER_ID = "spiral.core.visualizer.bars";

const SKIN_GLOBAL_VISUALIZER = "global";

type SkinVisualizerRef =
  { mode: "global" } | { mode: "fixed"; visualizerId: string };

function resolveSkinVisualizerRef(
  visualizer: SkinVisualizer | undefined,
): SkinVisualizerRef {
  if (!visualizer) return { mode: "global" };

  const id = visualizer.id?.trim();
  if (!id || id.toLowerCase() === SKIN_GLOBAL_VISUALIZER) {
    return { mode: "global" };
  }
  return { mode: "fixed", visualizerId: id };
}

/** Fixed visualizer id from skin manifest, or null to follow the global picker. */
export function resolveSkinVisualizerFixedId(
  visualizer: SkinVisualizer | undefined,
): string | null {
  const ref = resolveSkinVisualizerRef(visualizer);
  return ref.mode === "fixed" ? ref.visualizerId : null;
}

function manifestToVisualizer(
  id: string,
  manifest: VizManifest,
  packDir?: string,
): Visualizer {
  return {
    id,
    packDir,
    children: manifest.children,
  };
}

export function toVisualizer(loaded: LoadedVisualizer): Visualizer {
  return manifestToVisualizer(
    loaded.summary.id,
    loaded.manifest,
    loaded.packDir,
  );
}
