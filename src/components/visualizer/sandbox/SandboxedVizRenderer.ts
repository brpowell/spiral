/**
 * Host-side bridge: runs pack renderer source in a dedicated worker against an
 * OffscreenCanvas (canvas2d or webgl), then blits returned ImageBitmaps onto
 * the display canvas.
 */

import type { VizRendererEngine } from "../../../types/renderer";
import { readVizRendererPayload } from "../packRendererLoader";
import type { VizFrame } from "../vizRendererApi";
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
      return typeof msg.rendererId === "string"
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
  rendererId: string;
  /** When omitted, engine is read from the pack renderer manifest. */
  engine?: VizRendererEngine;
  width: number;
  height: number;
  dpr: number;
  /** Fires once after the first frame has been blitted to the display canvas. */
  onFirstFrame?: () => void;
  /**
   * Aborts in-flight init and disposes the worker once created
   * (e.g. React effect cleanup). Kept for the sandbox lifetime.
   */
  signal?: AbortSignal;
}

export class SandboxedVizRenderer {
  private worker: Worker;
  private displayCtx: CanvasRenderingContext2D;
  private rendererId: string;
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
  private firstFrameNotified = false;

  private constructor(
    worker: Worker,
    displayCtx: CanvasRenderingContext2D,
    rendererId: string,
    engine: VizRendererEngine,
    onFirstFrame?: () => void,
  ) {
    this.worker = worker;
    this.displayCtx = displayCtx;
    this.rendererId = rendererId;
    this.engine = engine;
    this.onFirstFrame = onFirstFrame ?? null;
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

    const payload = await readVizRendererPayload(opts.rendererId);
    if (signal?.aborted) {
      throw new Error("sandbox init aborted");
    }

    const engine = opts.engine ?? payload.engine;
    if (engine !== payload.engine) {
      throw new Error(
        `renderer ${opts.rendererId} is engine "${payload.engine}", expected "${engine}"`,
      );
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
      opts.rendererId,
      engine,
      opts.onFirstFrame,
    );
    host.syncDisplaySize(size);

    const onAbort = (): void => {
      host.dispose();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const initBudgetMs =
      engine === "webgl" ? WEBGL_INIT_BUDGET_MS : INIT_BUDGET_MS;
    let initTimeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const initMsg: HostToWorkerMessage = {
        type: "init",
        rendererId: opts.rendererId,
        engine,
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
  postFrame(frame: VizFrame, params: Record<string, unknown>): void {
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
      frame,
      params,
    };
    this.worker.postMessage(msg, transfer);
  }

  /** Post one frame and resolve after it has been blitted to the display canvas. */
  postFrameAndWait(
    frame: VizFrame,
    params: Record<string, unknown>,
  ): Promise<void> {
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
        this.postFrame(frame, params);
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
      this.worker.postMessage({ type: "dispose" } satisfies HostToWorkerMessage);
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
      `[viz-sandbox] terminating ${this.rendererId} (${this.engine}): ${reason}`,
    );
    this.status = "terminated";
    const waiter = this.frameWaiter;
    this.frameWaiter = null;
    waiter?.reject(new Error(reason));
    if (!this.readySettled) {
      this.readySettled = true;
      this.rejectReady(new Error(reason));
    }
    this.dispose();
  }
}
