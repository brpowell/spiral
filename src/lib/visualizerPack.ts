import type { SkinVisualizer } from "../types/skin";
import type { LoadedVisualizerPack, VizManifest } from "../types/visualizer";
import type { VisualizerPack } from "../components/visualizer/types";

export const DEFAULT_VISUALIZER_ID = "bars";

const SKIN_GLOBAL_VISUALIZER_PACK = "global";

const PRESET_TO_PACK: Record<string, string> = {
  bars: "bars",
  wave: "wave",
  spectrum: "spectrum",
};

type SkinVisualizerPackRef =
  | { mode: "global" }
  | { mode: "fixed"; packId: string };

function isGlobalPackRef(pack: string): boolean {
  const normalized = pack.trim().toLowerCase();
  return (
    normalized === SKIN_GLOBAL_VISUALIZER_PACK || normalized === "@global"
  );
}

function resolveSkinVisualizerPackRef(
  visualizer: SkinVisualizer | undefined,
): SkinVisualizerPackRef {
  if (!visualizer) return { mode: "global" };

  if (visualizer.pack?.trim()) {
    const pack = visualizer.pack.trim();
    if (isGlobalPackRef(pack)) return { mode: "global" };
    return { mode: "fixed", packId: pack };
  }

  if (visualizer.preset) {
    const packId = PRESET_TO_PACK[visualizer.preset];
    if (packId) return { mode: "fixed", packId };
  }

  return { mode: "global" };
}

/** Fixed pack id from skin manifest, or null to follow the global picker. */
export function resolveSkinVisualizerFixedPackId(
  visualizer: SkinVisualizer | undefined,
): string | null {
  const ref = resolveSkinVisualizerPackRef(visualizer);
  return ref.mode === "fixed" ? ref.packId : null;
}

function manifestToVisualizerPack(
  id: string,
  manifest: VizManifest,
  packDir?: string,
): VisualizerPack {
  return {
    id,
    packDir,
    surfaces: manifest.surfaces,
    reducedSurfaces: manifest.reducedSurfaces,
  };
}

export function loadedPackToVisualizerPack(
  loaded: LoadedVisualizerPack,
): VisualizerPack {
  return manifestToVisualizerPack(
    loaded.summary.id,
    loaded.manifest,
    loaded.packDir,
  );
}
