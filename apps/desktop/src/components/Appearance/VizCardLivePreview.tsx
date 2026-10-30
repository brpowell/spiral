import { useEffect, useState } from "react";
import { useVisualizerStore } from "../../store/useVisualizerStore";
import { useThemePalette } from "../visualizer/context";
import { SceneRenderer } from "../visualizer/scene/SceneRenderer";
import type { Visualizer } from "../visualizer/types";
import { useVizCardPreviewFrameRef } from "./vizCardPreviewAudio";

export function VizCardLivePreview({
  visualizerId,
  themed = false,
  onReady,
}: {
  visualizerId: string;
  /** Preview with a coverless placeholder track in the theme's colours. */
  themed?: boolean;
  onReady?: () => void;
}) {
  const themePalette = useThemePalette();
  const getVisualizer = useVisualizerStore((s) => s.getVisualizer);
  const cached = useVisualizerStore((s) => s.visualizerCache[visualizerId]);
  const { remoteFrameRef, forcePlaying } = useVizCardPreviewFrameRef();
  const [visualizer, setVisualizer] = useState<Visualizer | null>(
    () => cached ?? null,
  );

  useEffect(() => {
    if (cached) {
      setVisualizer(cached);
      return;
    }
    let cancelled = false;
    void getVisualizer(visualizerId)
      .then((loaded) => {
        if (!cancelled) setVisualizer(loaded);
      })
      .catch((err: unknown) => {
        console.error(`[viz-card-live] failed to load ${visualizerId}`, err);
      });
    return () => {
      cancelled = true;
    };
  }, [visualizerId, getVisualizer, cached]);

  if (!visualizer) return null;

  const scene = visualizer.children;

  return (
    <div className="visualizer-picker__live" aria-hidden>
      <SceneRenderer
        key={visualizer.id}
        scene={scene}
        visualizerId={visualizer.id}
        packDir={visualizer.packDir}
        variant="dock"
        expanded={false}
        onToggleExpand={() => {}}
        showExpandToggle={false}
        fillContainer
        remoteFrameRef={remoteFrameRef}
        previewForcePlaying={forcePlaying}
        previewArtColors={themed ? themePalette : undefined}
        onFirstFrame={onReady}
      />
    </div>
  );
}
