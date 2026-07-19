import { useEffect, useState } from "react";
import { useVisualizerStore } from "../../store/useVisualizerStore";
import { resolveSurfaceScene } from "../visualizer/fallbackVisualizer";
import { SceneRenderer } from "../visualizer/scene/SceneRenderer";
import type { Visualizer } from "../visualizer/types";
import { useVizCardPreviewFrameRef } from "./vizCardPreviewAudio";

export function VizCardLivePreview({
  visualizerId,
  onReady,
}: {
  visualizerId: string;
  onReady?: () => void;
}) {
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
        console.error(
          `[viz-card-live] failed to load ${visualizerId}`,
          err,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [visualizerId, getVisualizer, cached]);

  if (!visualizer) return null;

  const scene = resolveSurfaceScene(visualizer);

  return (
    <div className="visualizer-picker__live" aria-hidden>
      <SceneRenderer
        key={visualizer.id}
        scene={scene}
        packDir={visualizer.packDir}
        variant="dock"
        expanded={false}
        onToggleExpand={() => {}}
        showExpandToggle={false}
        fillContainer
        remoteFrameRef={remoteFrameRef}
        previewForcePlaying={forcePlaying}
        onFirstFrame={onReady}
      />
    </div>
  );
}
