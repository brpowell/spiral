import { invoke } from "@tauri-apps/api/core";
import { isSafeVizEntry } from "./vizRendererApi";

export interface VizLayerSourcePayload {
  source: string;
}

const payloadCache = new Map<string, Promise<VizLayerSourcePayload>>();

function cacheKey(visualizerId: string, entry: string): string {
  return `${visualizerId}\0${entry}`;
}

/**
 * Read pack visualizer layer source by effective visualizer id + entry filename.
 * Evaluation happens in the sandbox worker for both canvas2d and webgl.
 */
export function readVizLayerSource(
  visualizerId: string,
  entry: string,
): Promise<VizLayerSourcePayload> {
  if (!visualizerId || !isSafeVizEntry(entry)) {
    return Promise.reject(
      new Error(
        `Invalid visualizer layer source request: ${visualizerId} / ${entry}`,
      ),
    );
  }

  const key = cacheKey(visualizerId, entry);
  let pending = payloadCache.get(key);
  if (!pending) {
    pending = invoke<VizLayerSourcePayload>("read_viz_layer_source", {
      visualizerId,
      entry,
    });
    payloadCache.set(key, pending);
    pending.catch(() => {
      payloadCache.delete(key);
    });
  }
  return pending;
}
