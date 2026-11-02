import { create } from "zustand";
import {
  DEFAULT_VISUALIZER_ID,
  toVisualizer,
} from "../lib/resolveVisualizer";
import {
  getActiveVisualizerId,
  listVisualizers,
  loadVisualizer,
  saveActiveVisualizerId,
} from "../lib/tauri";
import type { VizSummary } from "../types/visualizer";
import type { Visualizer } from "../components/visualizer/types";
import { BARS_FALLBACK_VISUALIZER } from "../components/visualizer/fallbackVisualizer";
import { emitVisualizerChanged } from "../lib/visualizerBridge";
import { adjacentVisualizerId } from "../lib/visualizerCycle";

interface VisualizerState {
  visualizers: VizSummary[];
  activeVisualizerId: string;
  visualizerCache: Record<string, Visualizer>;
  loadVisualizers: () => Promise<void>;
  initializeFromBootstrap: (
    visualizers: VizSummary[],
    activeVisualizerId: string,
    initialCache: Record<string, Visualizer>,
  ) => void;
  setActiveVisualizer: (visualizerId: string) => Promise<void>;
  cycleActiveVisualizer: (direction: "next" | "prev") => Promise<void>;
  /** Update active visualizer in memory (and cache). Used by cross-window sync. */
  applyActiveVisualizer: (visualizerId: string) => Promise<void>;
  getVisualizer: (visualizerId: string) => Promise<Visualizer>;
}

export const useVisualizerStore = create<VisualizerState>((set, get) => ({
  visualizers: [],
  activeVisualizerId: DEFAULT_VISUALIZER_ID,
  visualizerCache: { [DEFAULT_VISUALIZER_ID]: BARS_FALLBACK_VISUALIZER },

  initializeFromBootstrap: (visualizers, activeVisualizerId, initialCache) => {
    set({
      visualizers,
      activeVisualizerId,
      visualizerCache: initialCache,
    });
  },

  loadVisualizers: async () => {
    const [summaries, activeVisualizerId] = await Promise.all([
      listVisualizers(),
      getActiveVisualizerId(),
    ]);
    const resolvedId = summaries.some((v) => v.id === activeVisualizerId)
      ? activeVisualizerId
      : DEFAULT_VISUALIZER_ID;

    let active = BARS_FALLBACK_VISUALIZER;
    try {
      const loaded = await loadVisualizer(resolvedId);
      active = toVisualizer(loaded);
    } catch (err) {
      console.error(`Failed to load visualizer "${resolvedId}":`, err);
    }

    set({
      visualizers: summaries,
      activeVisualizerId: resolvedId,
      visualizerCache: { ...get().visualizerCache, [resolvedId]: active },
    });
  },

  setActiveVisualizer: async (visualizerId) => {
    await get().applyActiveVisualizer(visualizerId);
    await saveActiveVisualizerId(visualizerId);
    emitVisualizerChanged(visualizerId);
  },

  cycleActiveVisualizer: async (direction) => {
    const nextId = adjacentVisualizerId(
      get().visualizers,
      get().activeVisualizerId,
      direction,
    );
    if (!nextId) return;
    await get().setActiveVisualizer(nextId);
  },

  applyActiveVisualizer: async (visualizerId) => {
    const visualizer = await get().getVisualizer(visualizerId);
    set({
      activeVisualizerId: visualizerId,
      visualizerCache: {
        ...get().visualizerCache,
        [visualizerId]: visualizer,
      },
    });
  },

  getVisualizer: async (visualizerId) => {
    const cached = get().visualizerCache[visualizerId];
    if (cached) return cached;

    const loaded = await loadVisualizer(visualizerId);
    const visualizer = toVisualizer(loaded);
    set({
      visualizerCache: {
        ...get().visualizerCache,
        [visualizerId]: visualizer,
      },
    });
    return visualizer;
  },
}));
