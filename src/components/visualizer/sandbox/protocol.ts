/**
 * Host ↔ worker message protocol for sandboxed VizRenderers.
 */

import type { VizRendererEngine } from "../../../types/renderer";
import type { VizFrame } from "../vizRendererApi";

/** Soft budget: late acks count as overruns (backpressure already skips frames). */
export const FRAME_BUDGET_MS = 32;

/** Hard budget: a single render slower than this terminates the worker. */
export const FATAL_BUDGET_MS = 250;

/** Soft/hard budgets for heavier webgl / three.js frames. */
export const WEBGL_FRAME_BUDGET_MS = 48;
export const WEBGL_FATAL_BUDGET_MS = 500;

/** Consecutive soft overruns before the host kills the worker. */
export const MAX_FRAME_OVERRUNS = 45;

export type HostToWorkerMessage =
  | {
      type: "init";
      rendererId: string;
      engine: VizRendererEngine;
      source: string;
      canvas: OffscreenCanvas;
      width: number;
      height: number;
      dpr: number;
    }
  | {
      type: "resize";
      width: number;
      height: number;
      dpr: number;
    }
  | {
      type: "frame";
      seq: number;
      frame: VizFrame;
      params: Record<string, unknown>;
    }
  | { type: "dispose" };

export type WorkerToHostMessage =
  | { type: "ready"; rendererId: string }
  | { type: "rendered"; seq: number; bitmap: ImageBitmap }
  | { type: "error"; message: string };
