import type { VizSummary } from "../types/visualizer";

export function adjacentVisualizerId(
  visualizers: readonly VizSummary[],
  activeVisualizerId: string,
  direction: "next" | "prev",
): string | null {
  if (visualizers.length <= 1) return null;

  const ids = visualizers.map((v) => v.id);
  const idx = ids.indexOf(activeVisualizerId);
  const currentIdx = idx >= 0 ? idx : 0;
  const delta = direction === "next" ? 1 : -1;
  return ids[(currentIdx + delta + ids.length) % ids.length];
}

export function activeVisualizerName(
  visualizers: readonly VizSummary[],
  activeVisualizerId: string,
): string {
  return visualizers.find((v) => v.id === activeVisualizerId)?.name ?? "";
}

export function canCycleVisualizers(
  visualizers: readonly VizSummary[],
): boolean {
  return visualizers.length > 1;
}
