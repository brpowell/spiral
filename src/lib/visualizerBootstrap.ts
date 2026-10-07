import { DEFAULT_VISUALIZER_ID, toVisualizer } from "./resolveVisualizer";
import { getVisualizerBootstrap } from "./tauri";
import { useVisualizerStore } from "../store/useVisualizerStore";
import { BARS_FALLBACK_VISUALIZER } from "../components/visualizer/fallbackVisualizer";

export async function bootstrapVisualizer(): Promise<void> {
  try {
    const boot = await getVisualizerBootstrap();
    const resolvedId = boot.summaries.some(
      (v) => v.id === boot.activeVisualizerId,
    )
      ? boot.activeVisualizerId
      : DEFAULT_VISUALIZER_ID;

    let initialCache = { [DEFAULT_VISUALIZER_ID]: BARS_FALLBACK_VISUALIZER };
    if (boot.visualizer) {
      initialCache = {
        ...initialCache,
        [resolvedId]: toVisualizer(boot.visualizer),
      };
    } else {
      console.error(`Visualizer bootstrap: failed to load "${resolvedId}"`);
    }

    useVisualizerStore
      .getState()
      .initializeFromBootstrap(boot.summaries, resolvedId, initialCache);
  } catch (err) {
    console.error("Visualizer bootstrap failed:", err);
    useVisualizerStore
      .getState()
      .initializeFromBootstrap([], DEFAULT_VISUALIZER_ID, {
        [DEFAULT_VISUALIZER_ID]: BARS_FALLBACK_VISUALIZER,
      });
  }
}
