import {
  DEFAULT_VISUALIZER_ID,
  loadedPackToVisualizerPack,
} from "./visualizerPack";
import {
  getActiveVisualizerId,
  listVisualizers,
  loadVisualizerPack,
} from "./tauri";
import { useVisualizerStore } from "../store/useVisualizerStore";
import { BARS_FALLBACK_PACK } from "../components/visualizer/packs";

export async function bootstrapVisualizer(): Promise<void> {
  try {
    const [summaries, activePackId] = await Promise.all([
      listVisualizers(),
      getActiveVisualizerId(),
    ]);

    const resolvedId = summaries.some((pack) => pack.id === activePackId)
      ? activePackId
      : DEFAULT_VISUALIZER_ID;

    let initialCache = { [DEFAULT_VISUALIZER_ID]: BARS_FALLBACK_PACK };
    try {
      const loaded = await loadVisualizerPack(resolvedId);
      initialCache = {
        ...initialCache,
        [resolvedId]: loadedPackToVisualizerPack(loaded),
      };
    } catch (err) {
      console.error(`Visualizer bootstrap: failed to load "${resolvedId}":`, err);
    }

    useVisualizerStore
      .getState()
      .initializeFromBootstrap(summaries, resolvedId, initialCache);
  } catch (err) {
    console.error("Visualizer bootstrap failed:", err);
    useVisualizerStore.getState().initializeFromBootstrap(
      [],
      DEFAULT_VISUALIZER_ID,
      { [DEFAULT_VISUALIZER_ID]: BARS_FALLBACK_PACK },
    );
  }
}
