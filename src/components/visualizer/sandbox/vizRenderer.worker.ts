/**
 * Dedicated worker for pack VizRenderer modules (canvas2d + webgl).
 *
 * canvas2d: create() → render(ctx, frame, params)
 * webgl:    create({ canvas, THREE }) → render(frame, params)
 *
 * Draws to a transferred OffscreenCanvas, then returns an ImageBitmap each
 * frame for the host to blit onto the display canvas.
 *
 * Globals are allowlist-locked before pack source runs; only the single
 * host-supplied entry module is imported (blob URL).
 */

import * as THREE from "three";
import type { VizRendererEngine } from "../../../types/renderer";
import type {
  VizRendererInstance,
  VizRendererModule,
  VizWebGLRendererInstance,
  VizWebGLRendererModule,
} from "../vizRendererApi";
import type { HostToWorkerMessage, WorkerToHostMessage } from "./protocol";
import {
  assertAudioBuffersWithinBudget,
  assertCanvasWithinBudget,
  assertRendererSourceWithinBudget,
  clampVizRenderSize,
} from "./resourceBudgets";
import { assertVizRendererSourceAllowed } from "./vizSourceGuard";
import {
  lockDownWorkerGlobals,
  sealBlobUrlApi,
} from "./workerGlobalLockdown";

const workerScope = self as unknown as {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<HostToWorkerMessage>) => void,
  ) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  close: () => void;
};

/**
 * Capture native postMessage/close before `lockDownWorkerGlobals` denies the
 * global names — pack code must not be able to forge protocol messages or
 * terminate the worker by calling `postMessage`/`close` directly.
 */
const nativePostMessage = workerScope.postMessage.bind(workerScope);
const nativeClose = workerScope.close.bind(workerScope);

function post(msg: WorkerToHostMessage, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    nativePostMessage(msg, transfer);
  } else {
    nativePostMessage(msg);
  }
}

let engine: VizRendererEngine | null = null;
let canvas2dInstance: VizRendererInstance | null = null;
let webglInstance: VizWebGLRendererInstance | null = null;
let canvas: OffscreenCanvas | null = null;
let ctx2d: OffscreenCanvasRenderingContext2D | null = null;
let lastSize = clampVizRenderSize(1, 1, 1);

function applyCanvas2dSize(width: number, height: number, dpr: number): void {
  if (!canvas || !ctx2d) return;
  const size = clampVizRenderSize(width, height, dpr);
  lastSize = size;
  if (canvas.width !== size.pixelWidth || canvas.height !== size.pixelHeight) {
    canvas.width = size.pixelWidth;
    canvas.height = size.pixelHeight;
  }
  ctx2d.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
}

function applyWebglSize(width: number, height: number, dpr: number): void {
  if (!canvas) return;
  const size = clampVizRenderSize(width, height, dpr);
  lastSize = size;
  if (canvas.width !== size.pixelWidth || canvas.height !== size.pixelHeight) {
    canvas.width = size.pixelWidth;
    canvas.height = size.pixelHeight;
  }
  webglInstance?.resize?.(size.width, size.height, size.dpr);
}

/** transferToImageBitmap() resets the canvas to 0×0 — restore before the next draw. */
function ensureBackingStore(): void {
  if (!canvas) return;
  if (
    canvas.width !== lastSize.pixelWidth ||
    canvas.height !== lastSize.pixelHeight
  ) {
    canvas.width = lastSize.pixelWidth;
    canvas.height = lastSize.pixelHeight;
    if (engine === "canvas2d" && ctx2d) {
      ctx2d.setTransform(lastSize.dpr, 0, 0, lastSize.dpr, 0, 0);
    } else if (engine === "webgl") {
      webglInstance?.resize?.(lastSize.width, lastSize.height, lastSize.dpr);
    }
  }
}

async function handleInit(
  msg: Extract<HostToWorkerMessage, { type: "init" }>,
): Promise<void> {
  lockDownWorkerGlobals(globalThis);
  assertVizRendererSourceAllowed(msg.source);
  assertRendererSourceWithinBudget(msg.source);

  engine = msg.engine;
  canvas = msg.canvas;

  const blob = new Blob([msg.source], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    if (msg.engine === "canvas2d") {
      ctx2d = canvas.getContext("2d");
      if (!ctx2d) {
        throw new Error("OffscreenCanvas 2d context unavailable");
      }
      applyCanvas2dSize(msg.width, msg.height, msg.dpr);

      const mod = (await import(/* @vite-ignore */ url)) as VizRendererModule;
      if (typeof mod.create !== "function") {
        throw new Error(`${msg.rendererId} must export a create() factory`);
      }
      canvas2dInstance = mod.create();
    } else {
      applyWebglSize(msg.width, msg.height, msg.dpr);

      const mod = (await import(/* @vite-ignore */ url)) as VizWebGLRendererModule;
      if (typeof mod.create !== "function") {
        throw new Error(`${msg.rendererId} must export a create() factory`);
      }
      webglInstance = mod.create({ canvas, THREE });
      webglInstance.resize?.(lastSize.width, lastSize.height, lastSize.dpr);
      canvas.addEventListener("webglcontextlost", handleContextLost);
    }
    assertCanvasWithinBudget(canvas);
  } finally {
    URL.revokeObjectURL(url);
    sealBlobUrlApi();
  }

  post({ type: "ready", rendererId: msg.rendererId });
}

function handleResize(
  msg: Extract<HostToWorkerMessage, { type: "resize" }>,
): void {
  if (engine === "canvas2d") {
    applyCanvas2dSize(msg.width, msg.height, msg.dpr);
    return;
  }
  if (engine === "webgl" && webglInstance) {
    applyWebglSize(msg.width, msg.height, msg.dpr);
  }
}

function handleFrame(
  msg: Extract<HostToWorkerMessage, { type: "frame" }>,
): void {
  if (!canvas) {
    throw new Error("renderer not initialized");
  }

  assertAudioBuffersWithinBudget(
    msg.frame.audio.frequencies,
    msg.frame.audio.waveform,
  );

  ensureBackingStore();

  if (engine === "canvas2d") {
    if (!ctx2d || !canvas2dInstance) {
      throw new Error("canvas2d renderer not initialized");
    }
    canvas2dInstance.render(ctx2d, msg.frame, msg.params);
  } else if (engine === "webgl") {
    if (!webglInstance) {
      throw new Error("webgl renderer not initialized");
    }
    webglInstance.render(msg.frame, msg.params);
  } else {
    throw new Error("renderer engine not set");
  }

  assertCanvasWithinBudget(canvas);

  const bitmap = canvas.transferToImageBitmap();
  post({ type: "rendered", seq: msg.seq, bitmap }, [bitmap]);
}

function handleDispose(): void {
  try {
    canvas2dInstance?.dispose?.();
  } catch {
    // ignore
  }
  try {
    webglInstance?.dispose?.();
  } catch {
    // ignore
  }
  canvas2dInstance = null;
  webglInstance = null;
  ctx2d = null;
  canvas = null;
  engine = null;
  nativeClose();
}

/**
 * `webglcontextlost` fires on driver crash/reset/resource exhaustion. Report
 * it like any other fatal error so the host disposes this one worker cleanly.
 */
function handleContextLost(event: Event): void {
  event.preventDefault();
  post({ type: "error", message: "webgl context lost" });
}

/**
 * Registered via addEventListener (not the `.onmessage` property) so pack
 * code assigning `self.onmessage = ...` cannot hijack host↔worker dispatch.
 */
workerScope.addEventListener(
  "message",
  (event: MessageEvent<HostToWorkerMessage>) => {
    const msg = event.data;
    void (async () => {
      try {
        switch (msg.type) {
          case "init":
            await handleInit(msg);
            break;
          case "resize":
            handleResize(msg);
            break;
          case "frame":
            handleFrame(msg);
            break;
          case "dispose":
            handleDispose();
            break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        post({ type: "error", message });
      }
    })();
  },
);
