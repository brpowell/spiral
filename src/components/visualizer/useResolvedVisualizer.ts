import { useEffect } from "react";
import { isAnySkinWindow } from "../../lib/windowRole";
import {
  DEFAULT_VISUALIZER_ID,
  resolveSkinVisualizerFixedId,
} from "../../lib/resolveVisualizer";
import { useSkinStore } from "../../store/useSkinStore";
import { useVisualizerStore } from "../../store/useVisualizerStore";
import { BARS_FALLBACK_VISUALIZER } from "./fallbackVisualizer";
import type { Visualizer } from "./types";

export function useResolvedVisualizer(): Visualizer {
  const skinFixedId = useSkinStore((s) => {
    if (!isAnySkinWindow()) return null;
    return resolveSkinVisualizerFixedId(s.activePack?.manifest.visualizer);
  });
  const globalId = useVisualizerStore((s) => s.activeVisualizerId);
  const getVisualizer = useVisualizerStore((s) => s.getVisualizer);

  const effectiveId = skinFixedId ?? globalId ?? DEFAULT_VISUALIZER_ID;
  const visualizer = useVisualizerStore(
    (s) => s.visualizerCache[effectiveId],
  );

  useEffect(() => {
    if (useVisualizerStore.getState().visualizerCache[effectiveId]) return;
    void getVisualizer(effectiveId);
  }, [effectiveId, getVisualizer]);

  return visualizer ?? BARS_FALLBACK_VISUALIZER;
}
