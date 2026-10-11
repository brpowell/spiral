/**
 * Host ↔ worker message protocol for sandboxed visualizer draw modules.
 */

import type { VizFrame, VizRendererEngine } from "../vizRendererApi";
import type { VizTrackImagePayload, VizTrackWire } from "../vizTrack";

export interface VizTrackMediaMessage {
  art: VizTrackImagePayload | null;
  portraits: VizTrackImagePayload[];
}

/** Per-frame payload. Track bitmaps are attached in the worker from `trackMedia`. */
export type VizFrameMessage = Omit<VizFrame, "trackMetadata"> & {
  trackMetadata: VizTrackWire;
};

/** Soft budget: late acks count as overruns (backpressure already skips frames). */
export const FRAME_BUDGET_MS = 32;

/** Hard budget: a single render slower than this terminates the worker. */
export const FATAL_BUDGET_MS = 250;

/** Soft/hard budgets for heavier webgl / three.js frames. */
export const WEBGL_FRAME_BUDGET_MS = 48;
export const WEBGL_FATAL_BUDGET_MS = 500;

/**
 * Hard budget for worker init (module load + create()). Longer than a frame
 * budget because THREE / WebGL setup can take hundreds of ms on cold start.
 */
export const INIT_BUDGET_MS = 2000;
export const WEBGL_INIT_BUDGET_MS = 5000;

/** Consecutive soft overruns before the host kills the worker. */
export const MAX_FRAME_OVERRUNS = 45;

export type HostToWorkerMessage =
  | {
      type: "init";
      layerLabel: string;
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
      frame: VizFrameMessage;
    }
  | ({ type: "trackMedia" } & VizTrackMediaMessage)
  | { type: "dispose" };

export type WorkerToHostMessage =
  | { type: "ready"; layerLabel: string }
  | { type: "rendered"; seq: number; bitmap: ImageBitmap }
  | { type: "error"; message: string };
