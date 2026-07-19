/**
 * Dedicated worker for pack VizRenderer modules (canvas2d + webgl).
 *
 * canvas2d: create() → render(ctx, frame, params)
 * webgl:    create({ canvas, THREE }) → render(frame, params)
 *
 * Draws to a transferred OffscreenCanvas, then returns an ImageBitmap each
 * frame for the host to blit onto the display canvas.
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

const workerScope = self as unknown as {
  fetch: typeof fetch;
  XMLHttpRequest: typeof XMLHttpRequest;
  WebSocket: typeof WebSocket;
  EventSource: typeof EventSource;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  close: () => void;
  onmessage: ((event: MessageEvent<HostToWorkerMessage>) => void) | null;
};

function lockDownNetwork(): void {
  const deny = () =>
    Promise.reject(new Error("[viz-sandbox] network disabled"));
  workerScope.fetch = deny as typeof fetch;
  workerScope.XMLHttpRequest = class {
    constructor() {
      throw new Error("[viz-sandbox] network disabled");
    }
  } as unknown as typeof XMLHttpRequest;
  workerScope.WebSocket = class {
    constructor() {
      throw new Error("[viz-sandbox] network disabled");
    }
  } as unknown as typeof WebSocket;
  workerScope.EventSource = class {
    constructor() {
      throw new Error("[viz-sandbox] network disabled");
    }
  } as unknown as typeof EventSource;
}

function post(msg: WorkerToHostMessage, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    workerScope.postMessage(msg, transfer);
  } else {
    workerScope.postMessage(msg);
  }
}

let engine: VizRendererEngine | null = null;
let canvas2dInstance: VizRendererInstance | null = null;
let webglInstance: VizWebGLRendererInstance | null = null;
let canvas: OffscreenCanvas | null = null;
let ctx2d: OffscreenCanvasRenderingContext2D | null = null;

function applyCanvas2dSize(width: number, height: number, dpr: number): void {
  if (!canvas || !ctx2d) return;
  const pixelW = Math.max(1, Math.floor(Math.max(1, width) * dpr));
  const pixelH = Math.max(1, Math.floor(Math.max(1, height) * dpr));
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW;
    canvas.height = pixelH;
  }
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

async function handleInit(
  msg: Extract<HostToWorkerMessage, { type: "init" }>,
): Promise<void> {
  lockDownNetwork();

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
      const pixelW = Math.max(1, Math.floor(msg.width * msg.dpr));
      const pixelH = Math.max(1, Math.floor(msg.height * msg.dpr));
      canvas.width = pixelW;
      canvas.height = pixelH;

      const mod = (await import(/* @vite-ignore */ url)) as VizWebGLRendererModule;
      if (typeof mod.create !== "function") {
        throw new Error(`${msg.rendererId} must export a create() factory`);
      }
      webglInstance = mod.create({ canvas, THREE });
      webglInstance.resize?.(msg.width, msg.height, msg.dpr);
    }
  } finally {
    URL.revokeObjectURL(url);
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
  if (engine === "webgl" && canvas && webglInstance) {
    const pixelW = Math.max(1, Math.floor(msg.width * msg.dpr));
    const pixelH = Math.max(1, Math.floor(msg.height * msg.dpr));
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    webglInstance.resize?.(msg.width, msg.height, msg.dpr);
  }
}

function handleFrame(
  msg: Extract<HostToWorkerMessage, { type: "frame" }>,
): void {
  if (!canvas) {
    throw new Error("renderer not initialized");
  }

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
  workerScope.close();
}

workerScope.onmessage = (event: MessageEvent<HostToWorkerMessage>) => {
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
};
