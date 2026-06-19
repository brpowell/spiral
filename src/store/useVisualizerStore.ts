import { create } from "zustand";
import {
  DEFAULT_VISUALIZER_ID,
  loadedPackToVisualizerPack,
} from "../lib/visualizerPack";
import {
  getActiveVisualizerId,
  listVisualizers,
  loadVisualizerPack,
  openVisualizersFolder,
  saveActiveVisualizerId,
} from "../lib/tauri";
import type { VizSummary } from "../types/visualizer";
import type { VisualizerPack } from "../components/visualizer/types";
import { BARS_FALLBACK_PACK } from "../components/visualizer/packs";
import { emitVisualizerChanged } from "../lib/visualizerBridge";
import { adjacentVisualizerId } from "../lib/visualizerCycle";

interface VisualizerState {
  packs: VizSummary[];
  activePackId: string;
  packCache: Record<string, VisualizerPack>;
  loadPacks: () => Promise<void>;
  initializeFromBootstrap: (
    packs: VizSummary[],
    activePackId: string,
    initialCache: Record<string, VisualizerPack>,
  ) => void;
  setActivePack: (packId: string) => Promise<void>;
  cycleActivePack: (direction: "next" | "prev") => Promise<void>;
  /** Update active pack in memory (and cache). Used by cross-window sync. */
  applyActivePack: (packId: string) => Promise<void>;
  getPack: (packId: string) => Promise<VisualizerPack>;
  openVisualizersFolder: () => Promise<void>;
}

export const useVisualizerStore = create<VisualizerState>((set, get) => ({
  packs: [],
  activePackId: DEFAULT_VISUALIZER_ID,
  packCache: { [DEFAULT_VISUALIZER_ID]: BARS_FALLBACK_PACK },

  initializeFromBootstrap: (packs, activePackId, initialCache) => {
    set({
      packs,
      activePackId,
      packCache: initialCache,
    });
  },

  loadPacks: async () => {
    const [summaries, activePackId] = await Promise.all([
      listVisualizers(),
      getActiveVisualizerId(),
    ]);
    const resolvedId = summaries.some((pack) => pack.id === activePackId)
      ? activePackId
      : DEFAULT_VISUALIZER_ID;

    let activePack = BARS_FALLBACK_PACK;
    try {
      const loaded = await loadVisualizerPack(resolvedId);
      activePack = loadedPackToVisualizerPack(loaded);
    } catch (err) {
      console.error(`Failed to load visualizer pack "${resolvedId}":`, err);
    }

    set({
      packs: summaries,
      activePackId: resolvedId,
      packCache: { ...get().packCache, [resolvedId]: activePack },
    });
  },

  setActivePack: async (packId) => {
    await get().applyActivePack(packId);
    await saveActiveVisualizerId(packId);
    emitVisualizerChanged(packId);
  },

  cycleActivePack: async (direction) => {
    const nextId = adjacentVisualizerId(
      get().packs,
      get().activePackId,
      direction,
    );
    if (!nextId) return;
    await get().setActivePack(nextId);
  },

  applyActivePack: async (packId) => {
    const pack = await get().getPack(packId);
    set({
      activePackId: packId,
      packCache: { ...get().packCache, [packId]: pack },
    });
  },

  getPack: async (packId) => {
    const cached = get().packCache[packId];
    if (cached) return cached;

    const loaded = await loadVisualizerPack(packId);
    const pack = loadedPackToVisualizerPack(loaded);
    set({ packCache: { ...get().packCache, [packId]: pack } });
    return pack;
  },

  openVisualizersFolder: async () => {
    await openVisualizersFolder();
  },
}));
