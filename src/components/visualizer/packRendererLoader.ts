import { invoke } from "@tauri-apps/api/core";
import type { VizRendererEngine } from "../../types/renderer";
import { isRendererContributionId } from "./vizRendererApi";

export interface VizRendererPayload {
  source: string;
  engine: VizRendererEngine;
}

const payloadCache = new Map<string, Promise<VizRendererPayload>>();

/**
 * Read pack VizRenderer source + engine by effective contribution id.
 * Evaluation happens in the sandbox worker for both canvas2d and webgl.
 */
export function readVizRendererPayload(
  rendererId: string,
): Promise<VizRendererPayload> {
  if (!isRendererContributionId(rendererId)) {
    return Promise.reject(
      new Error(`Invalid renderer contribution id: ${rendererId}`),
    );
  }

  let pending = payloadCache.get(rendererId);
  if (!pending) {
    pending = invoke<VizRendererPayload>("read_viz_renderer_source", {
      rendererId,
    }).then((payload) => {
      if (payload.engine !== "canvas2d" && payload.engine !== "webgl") {
        throw new Error(
          `renderer ${rendererId} has unsupported engine "${payload.engine}"`,
        );
      }
      return payload as VizRendererPayload;
    });
    payloadCache.set(rendererId, pending);
    pending.catch(() => {
      payloadCache.delete(rendererId);
    });
  }
  return pending;
}
