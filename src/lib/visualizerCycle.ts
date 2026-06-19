import type { VizSummary } from "../types/visualizer";

export function adjacentVisualizerId(
  packs: readonly VizSummary[],
  activePackId: string,
  direction: "next" | "prev",
): string | null {
  if (packs.length <= 1) return null;

  const ids = packs.map((pack) => pack.id);
  const idx = ids.indexOf(activePackId);
  const currentIdx = idx >= 0 ? idx : 0;
  const delta = direction === "next" ? 1 : -1;
  return ids[(currentIdx + delta + ids.length) % ids.length];
}

export function activeVisualizerName(
  packs: readonly VizSummary[],
  activePackId: string,
): string {
  return packs.find((pack) => pack.id === activePackId)?.name ?? "";
}

export function canCycleVisualizers(packs: readonly VizSummary[]): boolean {
  return packs.length > 1;
}
