import {
  DEFAULT_VISUALIZER_ID,
  toVisualizer,
} from "./resolveVisualizer";
import {
  getActiveVisualizerId,
  listVisualizers,
  loadVisualizer,
} from "./tauri";
import { useVisualizerStore } from "../store/useVisualizerStore";
import { BARS_FALLBACK_VISUALIZER } from "../components/visualizer/fallbackVisualizer";

export async function bootstrapVisualizer(): Promise<void> {
  try {
    const [summaries, activeVisualizerId] = await Promise.all([
      listVisualizers(),
      getActiveVisualizerId(),
    ]);

    const resolvedId = summaries.some((v) => v.id === activeVisualizerId)
      ? activeVisualizerId
      : DEFAULT_VISUALIZER_ID;

    let initialCache = { [DEFAULT_VISUALIZER_ID]: BARS_FALLBACK_VISUALIZER };
    try {
      const loaded = await loadVisualizer(resolvedId);
      initialCache = {
        ...initialCache,
        [resolvedId]: toVisualizer(loaded),
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
      { [DEFAULT_VISUALIZER_ID]: BARS_FALLBACK_VISUALIZER },
    );
  }
}
