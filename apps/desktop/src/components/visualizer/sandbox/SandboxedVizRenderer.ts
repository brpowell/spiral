/**
 * Host-side bridge: runs pack visualizer entry source in a dedicated worker
 * against an OffscreenCanvas (canvas2d or webgl), then blits returned
 * ImageBitmaps onto the display canvas.
 */

import { readVizLayerSource } from "../packVizLayerLoader";
import type { VizFrame, VizRendererEngine } from "../vizRendererApi";
import {
  splitVizTrack,
  type VizTrackImagePayload,
  type VizTrackWire,
} from "../vizTrack";
import {
  FATAL_BUDGET_MS,
  FRAME_BUDGET_MS,
  INIT_BUDGET_MS,
  MAX_FRAME_OVERRUNS,
  WEBGL_FATAL_BUDGET_MS,
  WEBGL_FRAME_BUDGET_MS,
  WEBGL_INIT_BUDGET_MS,
  type HostToWorkerMessage,
  type WorkerToHostMessage,
} from "./protocol";
import {
  assertAudioBuffersWithinBudget,
  assertRendererSourceWithinBudget,
  clampVizRenderSize,
  isWithinPixelBudget,
  MAX_VIZ_TRACK_IMAGE_EDGE,
  type VizRenderSize,
} from "./resourceBudgets";
import { assertVizRendererSourceAllowed } from "./vizSourceGuard";

type SandboxedVizRendererStatus = "loading" | "ready" | "terminated";

/**
 * Treat every inbound worker message as untrusted. Pack code no longer has
 * a live `postMessage` global, but the host still shape-checks before reading
 * fields or blitting a bitmap (defense in depth against forged/malformed
 * structured-clone payloads).
 */
function parseWorkerMessage(data: unknown): WorkerToHostMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Record<string, unknown>;
  switch (msg.type) {
    case "ready":
      return typeof msg.layerLabel === "string"
        ? (msg as WorkerToHostMessage)
        : null;
    case "rendered":
      return typeof msg.seq === "number" &&
        Number.isFinite(msg.seq) &&
        msg.bitmap instanceof ImageBitmap
        ? (msg as WorkerToHostMessage)
        : null;
    case "error":
      return typeof msg.message === "string"
        ? (msg as WorkerToHostMessage)
        : null;
    default:
      return null;
  }
}

export interface SandboxedVizRendererOptions {
  /** Display canvas — host blits ImageBitmaps here; never transferred. */
  canvas: HTMLCanvasElement;
  visualizerId: string;
  entry: string;
  engine: VizRendererEngine;
  width: number;
  height: number;
  dpr: number;
  /** Fires once after the first frame has been blitted to the display canvas. */
  onFirstFrame?: () => void;
  /**
   * Fires once after a fatal terminate (watchdog, context loss, budget, etc.).
   * Not called for intentional `dispose()` / abort cleanup.
   */
  onTerminated?: (reason: string) => void;
  /**
   * Aborts in-flight init and disposes the worker once created
   * (e.g. React effect cleanup). Kept for the sandbox lifetime.
   */
  signal?: AbortSignal;
}

/** RGBA pixels for a track image. Null when the bitmap cannot be read. */
function encodeTrackImage(
  id: string,
  bitmap: ImageBitmap,
): VizTrackImagePayload | null {
  let width = 0;
  let height = 0;
  try {
    width = bitmap.width;
    height = bitmap.height;
  } catch {
    return null;
  }
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_VIZ_TRACK_IMAGE_EDGE ||
    height > MAX_VIZ_TRACK_IMAGE_EDGE
  ) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, width, height);
    const pixels = new Uint8ClampedArray(image.data);
    return { id, width, height, pixels: pixels.buffer };
  } catch {
    return null;
  }
}

export class SandboxedVizRenderer {
  private worker: Worker;
  private displayCtx: CanvasRenderingContext2D;
  private layerLabel: string;
  private engine: VizRendererEngine;
  private frameBudgetMs: number;
  private fatalBudgetMs: number;
  private status: SandboxedVizRendererStatus = "loading";
  private seq = 0;
  private pendingSeq: number | null = null;
  private pendingStartedAt = 0;
  private overrunCount = 0;
  private disposed = false;
  private readySettled = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;
  private watchdogId: ReturnType<typeof setInterval> | null = null;
  private frameWaiter: {
    resolve: () => void;
    reject: (err: Error) => void;
  } | null = null;
  private onFirstFrame: (() => void) | null;
  private onTerminated: ((reason: string) => void) | null;
  private firstFrameNotified = false;
  /** Image ids already copied into this worker. Pruned to the current track. */
  private sentTrackImageIds = new Set<string>();
  /** Ids we could not encode. Pruned with the sent set so a later track can retry. */
  private unsendableTrackImageIds = new Set<string>();

  private constructor(
    worker: Worker,
    displayCtx: CanvasRenderingContext2D,
    layerLabel: string,
    engine: VizRendererEngine,
    onFirstFrame?: () => void,
    onTerminated?: (reason: string) => void,
  ) {
    this.worker = worker;
    this.displayCtx = displayCtx;
    this.layerLabel = layerLabel;
    this.engine = engine;
    this.onFirstFrame = onFirstFrame ?? null;
    this.onTerminated = onTerminated ?? null;
    this.frameBudgetMs =
      engine === "webgl" ? WEBGL_FRAME_BUDGET_MS : FRAME_BUDGET_MS;
    this.fatalBudgetMs =
      engine === "webgl" ? WEBGL_FATAL_BUDGET_MS : FATAL_BUDGET_MS;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker.onmessage = (event: MessageEvent<unknown>) => {
      this.onWorkerMessage(event.data);
    };
    this.worker.onerror = (event) => {
      this.terminate(event.message || "worker error");
    };
    this.watchdogId = setInterval(
      () => this.tickWatchdog(),
      this.frameBudgetMs,
    );
  }

  static async create(
    opts: SandboxedVizRendererOptions,
  ): Promise<SandboxedVizRenderer> {
    const signal = opts.signal;
    if (signal?.aborted) {
      throw new Error("sandbox init aborted");
    }

    const displayCtx = opts.canvas.getContext("2d");
    if (!displayCtx) {
      throw new Error("display canvas 2d context unavailable");
    }
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("OffscreenCanvas is not available");
    }

    const layerLabel = `${opts.visualizerId}/${opts.entry}`;
    const payload = await readVizLayerSource(opts.visualizerId, opts.entry);
    if (signal?.aborted) {
      throw new Error("sandbox init aborted");
    }

    assertVizRendererSourceAllowed(payload.source);
    assertRendererSourceWithinBudget(payload.source);

    const size = clampVizRenderSize(opts.width, opts.height, opts.dpr);
    const offscreen = new OffscreenCanvas(size.pixelWidth, size.pixelHeight);

    const worker = new Worker(
      new URL("./vizRenderer.worker.ts", import.meta.url),
      { type: "module" },
    );

    const host = new SandboxedVizRenderer(
      worker,
      displayCtx,
      layerLabel,
      opts.engine,
      opts.onFirstFrame,
      opts.onTerminated,
    );
    host.syncDisplaySize(size);

    const onAbort = (): void => {
      host.dispose();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const initBudgetMs =
      opts.engine === "webgl" ? WEBGL_INIT_BUDGET_MS : INIT_BUDGET_MS;
    let initTimeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const initMsg: HostToWorkerMessage = {
        type: "init",
        layerLabel,
        engine: opts.engine,
        source: payload.source,
        canvas: offscreen,
        width: size.width,
        height: size.height,
        dpr: size.dpr,
      };
      worker.postMessage(initMsg, [offscreen]);

      await Promise.race([
        host.readyPromise,
        new Promise<never>((_, reject) => {
          initTimeoutId = setTimeout(() => {
            reject(new Error(`init exceeded budget (${initBudgetMs}ms)`));
          }, initBudgetMs);
        }),
      ]);
      if (host.disposed || signal?.aborted) {
        throw new Error("sandbox init aborted");
      }
      return host;
    } catch (err) {
      if (!host.disposed) {
        const message = err instanceof Error ? err.message : String(err);
        host.terminate(message);
      }
      signal?.removeEventListener("abort", onAbort);
      throw err;
    } finally {
      if (initTimeoutId !== null) {
        clearTimeout(initTimeoutId);
      }
    }
  }

  get ready(): boolean {
    return this.status === "ready";
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.disposed || this.status !== "ready") return;
    const size = clampVizRenderSize(width, height, dpr);
    this.syncDisplaySize(size);
    const msg: HostToWorkerMessage = {
      type: "resize",
      width: size.width,
      height: size.height,
      dpr: size.dpr,
    };
    this.worker.postMessage(msg);
  }

  /**
   * Post a frame. Skips if a previous frame is still in flight (backpressure).
   * Audio typed arrays are transferred to the worker.
   */
  postFrame(frame: VizFrame): void {
    if (this.disposed || this.status !== "ready") return;
    if (this.pendingSeq !== null) return;

    try {
      assertAudioBuffersWithinBudget(
        frame.audio.frequencies,
        frame.audio.waveform,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.terminate(message);
      return;
    }

    this.seq += 1;
    this.pendingSeq = this.seq;
    this.pendingStartedAt = performance.now();

    const trackMetadata = this.syncTrackMedia(frame);

    const transfer: Transferable[] = [];
    const freqBuf = frame.audio.frequencies.buffer;
    const waveBuf = frame.audio.waveform.buffer;
    if (freqBuf instanceof ArrayBuffer && freqBuf.byteLength > 0) {
      transfer.push(freqBuf);
    }
    if (
      waveBuf instanceof ArrayBuffer &&
      waveBuf.byteLength > 0 &&
      waveBuf !== freqBuf
    ) {
      transfer.push(waveBuf);
    }

    const msg: HostToWorkerMessage = {
      type: "frame",
      seq: this.seq,
      frame: { ...frame, trackMetadata },
    };
    this.worker.postMessage(msg, transfer);
  }

  /**
   * Copy album art and portraits into the worker only when they change.
   * Pixels are transferred — WebKit cannot structured-clone ImageBitmap.
   * The following frame message carries ids; the worker rebuilds the bitmaps.
   */
  private syncTrackMedia(frame: VizFrame): VizTrackWire {
    const split = splitVizTrack(frame.trackMetadata);
    const art = this.trackImagePayload(split.media.art);
    const portraits: VizTrackImagePayload[] = [];
    for (const portrait of split.media.portraits) {
      const payload = this.trackImagePayload(portrait);
      if (payload) portraits.push(payload);
    }
    if (art || portraits.length > 0) {
      const transfer: Transferable[] = [];
      if (art) transfer.push(art.pixels);
      for (const portrait of portraits) transfer.push(portrait.pixels);
      try {
        const msg: HostToWorkerMessage = {
          type: "trackMedia",
          art,
          portraits,
        };
        this.worker.postMessage(msg, transfer);
        if (art) this.sentTrackImageIds.add(art.id);
        for (const portrait of portraits) {
          this.sentTrackImageIds.add(portrait.id);
        }
      } catch (err) {
        console.error("[visualizer] failed to send track images", err);
        if (art) this.unsendableTrackImageIds.add(art.id);
        for (const portrait of portraits) {
          this.unsendableTrackImageIds.add(portrait.id);
        }
      }
    }

    const live = new Set<string>();
    if (split.wire.artId) live.add(split.wire.artId);
    for (const artist of split.wire.artists) {
      if (artist.portraitId) live.add(artist.portraitId);
    }
    for (const id of this.sentTrackImageIds) {
      if (!live.has(id)) this.sentTrackImageIds.delete(id);
    }
    for (const id of this.unsendableTrackImageIds) {
      if (!live.has(id)) this.unsendableTrackImageIds.delete(id);
    }
    return split.wire;
  }

  private trackImagePayload(
    image: { id: string; bitmap: ImageBitmap } | null,
  ): VizTrackImagePayload | null {
    if (!image) return null;
    if (
      this.sentTrackImageIds.has(image.id) ||
      this.unsendableTrackImageIds.has(image.id)
    ) {
      return null;
    }
    const payload = encodeTrackImage(image.id, image.bitmap);
    if (!payload) {
      this.unsendableTrackImageIds.add(image.id);
      return null;
    }
    return payload;
  }

  /** Post one frame and resolve after it has been blitted to the display canvas. */
  postFrameAndWait(frame: VizFrame): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.disposed || this.status !== "ready") {
        reject(new Error("sandbox not ready"));
        return;
      }

      const attempt = () => {
        if (this.disposed) {
          reject(new Error("sandbox disposed"));
          return;
        }
        if (this.pendingSeq !== null) {
          requestAnimationFrame(attempt);
          return;
        }
        this.frameWaiter = { resolve, reject };
        this.postFrame(frame);
        if (this.pendingSeq === null) {
          this.frameWaiter = null;
          reject(new Error("failed to post frame"));
        }
      };
      attempt();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onTerminated = null;
    if (this.watchdogId !== null) {
      clearInterval(this.watchdogId);
      this.watchdogId = null;
    }
    const waiter = this.frameWaiter;
    this.frameWaiter = null;
    waiter?.reject(new Error("sandbox disposed"));
    if (!this.readySettled) {
      this.readySettled = true;
      this.rejectReady(new Error("sandbox disposed"));
    }
    try {
      this.worker.postMessage({
        type: "dispose",
      } satisfies HostToWorkerMessage);
    } catch {
      // worker may already be dead
    }
    this.worker.terminate();
    this.pendingSeq = null;
  }

  private syncDisplaySize(size: VizRenderSize): void {
    const display = this.displayCtx.canvas;
    if (
      display.width !== size.pixelWidth ||
      display.height !== size.pixelHeight
    ) {
      display.width = size.pixelWidth;
      display.height = size.pixelHeight;
    }
    this.displayCtx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private onWorkerMessage(raw: unknown): void {
    const msg = parseWorkerMessage(raw);
    if (!msg) {
      // Malformed/forged message on the channel — treat as fatal, same as
      // any other protocol violation.
      this.terminate("received malformed message from worker");
      return;
    }

    if (this.disposed) {
      if (msg.type === "rendered") msg.bitmap.close();
      return;
    }

    switch (msg.type) {
      case "ready":
        if (!this.readySettled) {
          this.readySettled = true;
          this.status = "ready";
          this.resolveReady();
        }
        break;
      case "rendered":
        this.onRendered(msg.seq, msg.bitmap);
        break;
      case "error":
        this.terminate(msg.message);
        break;
    }
  }

  private onRendered(seq: number, bitmap: ImageBitmap): void {
    try {
      if (!isWithinPixelBudget(bitmap.width, bitmap.height)) {
        this.terminate(
          `[viz-sandbox] bitmap exceeded pixel budget (${bitmap.width}x${bitmap.height})`,
        );
        return;
      }

      if (this.pendingSeq !== seq) return;

      const display = this.displayCtx.canvas;
      this.displayCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.displayCtx.clearRect(0, 0, display.width, display.height);
      this.displayCtx.drawImage(bitmap, 0, 0);

      const elapsed = performance.now() - this.pendingStartedAt;
      this.pendingSeq = null;

      const waiter = this.frameWaiter;
      this.frameWaiter = null;
      waiter?.resolve();

      if (!this.firstFrameNotified) {
        this.firstFrameNotified = true;
        this.onFirstFrame?.();
      }

      if (elapsed > this.fatalBudgetMs) {
        this.terminate(
          `frame ${seq} exceeded fatal budget (${Math.round(elapsed)}ms)`,
        );
        return;
      }
      if (elapsed > this.frameBudgetMs) {
        this.overrunCount += 1;
        if (this.overrunCount >= MAX_FRAME_OVERRUNS) {
          this.terminate(
            `frame budget overrun limit (${this.overrunCount} consecutive soft overruns)`,
          );
        }
      } else {
        this.overrunCount = Math.max(0, this.overrunCount - 1);
      }
    } finally {
      bitmap.close();
    }
  }

  private tickWatchdog(): void {
    if (this.disposed || this.pendingSeq === null) return;
    const elapsed = performance.now() - this.pendingStartedAt;
    if (elapsed > this.fatalBudgetMs) {
      this.terminate(
        `watchdog: frame ${this.pendingSeq} stuck (${Math.round(elapsed)}ms)`,
      );
    }
  }

  private terminate(reason: string): void {
    if (this.disposed) return;
    console.error(
      `[viz-sandbox] terminating ${this.layerLabel} (${this.engine}): ${reason}`,
    );
    this.status = "terminated";
    const waiter = this.frameWaiter;
    this.frameWaiter = null;
    waiter?.reject(new Error(reason));
    if (!this.readySettled) {
      this.readySettled = true;
      this.rejectReady(new Error(reason));
    }
    const onTerminated = this.onTerminated;
    this.onTerminated = null;
    this.dispose();
    onTerminated?.(reason);
  }
}
