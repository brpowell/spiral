import {
  decompressFrames,
  parseGIF,
  type ParsedFrame,
  type ParsedGif,
} from "gifuct-js";

export interface DecodedSkinGif {
  width: number;
  height: number;
  frames: ParsedFrame[];
  /** Sum of per-frame delays in milliseconds. */
  totalDurationMs: number;
  /** `0` = loop forever; `null` = play once (no NETSCAPE extension). */
  loopCount: number | null;
}

export interface SkinGifPlaybackOptions {
  /**
   * Scales native GIF frame delays. `1` = file timing, `0.5` = half speed,
   * `2` = double speed. Ignored when `targetDurationMs` is set.
   */
  playbackRate?: number;
  /** Stretch or compress one loop to this duration (overrides `playbackRate`). */
  targetDurationMs?: number;
  /** Called after each full pass through the frame list (0-based). */
  onLoopComplete?: (loopIndex: number) => void;
  /** Called once after the first frame is composited onto the canvas. */
  onFirstFrameDrawn?: () => void;
  /** When true, ignore the file's NETSCAPE loop count and loop forever. */
  loopForever?: boolean;
}

export interface SkinGifPlaybackHandle {
  stop: () => void;
}

const decodeCache = new Map<string, Promise<DecodedSkinGif>>();
const decodedCache = new Map<string, DecodedSkinGif>();

function parseLoopCount(gif: ParsedGif): number | null {
  for (const frame of gif.frames) {
    if (!("application" in frame) || !frame.application) continue;
    if (frame.application.id !== "NETSCAPE2.0") continue;
    const blocks = frame.application.blocks;
    if (blocks.length === 0) return 0;
    return blocks[0] ?? 0;
  }
  return null;
}

function decodeSkinGif(buffer: ArrayBuffer): DecodedSkinGif {
  const gif = parseGIF(buffer);
  const frames = decompressFrames(gif, true);
  const totalDurationMs = frames.reduce((sum, frame) => sum + frame.delay, 0);
  return {
    width: gif.lsd.width,
    height: gif.lsd.height,
    frames,
    totalDurationMs,
    loopCount: parseLoopCount(gif),
  };
}

export function loadSkinGif(url: string): Promise<DecodedSkinGif> {
  let pending = decodeCache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch skin GIF: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then(decodeSkinGif)
      .then((decoded) => {
        decodedCache.set(url, decoded);
        return decoded;
      });
    decodeCache.set(url, pending);
  }
  return pending;
}

/**
 * Already-decoded GIF, available without awaiting. Lets a caller paint in the
 * same commit it mounts, rather than a tick later.
 */
export function getDecodedSkinGif(url: string): DecodedSkinGif | undefined {
  return decodedCache.get(url);
}

export function clearSkinGifDecodeCache(): void {
  decodeCache.clear();
  decodedCache.clear();
}

export function resolveGifPlaybackRate(
  decoded: DecodedSkinGif,
  options: Pick<SkinGifPlaybackOptions, "playbackRate" | "targetDurationMs">,
): number {
  if (options.targetDurationMs && decoded.totalDurationMs > 0) {
    return decoded.totalDurationMs / options.targetDurationMs;
  }
  if (options.playbackRate !== undefined && options.playbackRate > 0) {
    return options.playbackRate;
  }
  return 1;
}

export function compositeGifFramePatch(
  dest: Uint8ClampedArray,
  destWidth: number,
  frame: ParsedFrame,
): void {
  const { left, top, width, height } = frame.dims;
  const patch = frame.patch;
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const patchIndex = (py * width + px) * 4;
      if (patch[patchIndex + 3] === 0) continue;
      const destIndex = ((top + py) * destWidth + (left + px)) * 4;
      dest[destIndex] = patch[patchIndex];
      dest[destIndex + 1] = patch[patchIndex + 1];
      dest[destIndex + 2] = patch[patchIndex + 2];
      dest[destIndex + 3] = patch[patchIndex + 3];
    }
  }
}

function shouldContinueLoop(
  loopCount: number | null,
  completedLoops: number,
): boolean {
  if (loopCount === null) return completedLoops < 1;
  if (loopCount === 0) return true;
  return completedLoops <= loopCount;
}

export function resolveGifLoopCount(
  decoded: DecodedSkinGif,
  options: Pick<SkinGifPlaybackOptions, "loopForever"> = {},
): number | null {
  if (options.loopForever) return 0;
  return decoded.loopCount;
}

function createGifFrameCanvas(decoded: DecodedSkinGif): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  const canvas = document.createElement("canvas");
  canvas.width = decoded.width;
  canvas.height = decoded.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return { canvas, ctx };
}

function compositeGifFramesToCanvas(
  frameCtx: CanvasRenderingContext2D,
  decoded: DecodedSkinGif,
  upToFrameIndex = decoded.frames.length - 1,
): void {
  let previousFrame: ParsedFrame | null = null;
  const lastIndex = Math.min(upToFrameIndex, decoded.frames.length - 1);
  for (let index = 0; index <= lastIndex; index += 1) {
    const frame = decoded.frames[index];
    if (previousFrame?.disposalType === 2) {
      frameCtx.clearRect(
        previousFrame.dims.left,
        previousFrame.dims.top,
        previousFrame.dims.width,
        previousFrame.dims.height,
      );
    }
    const existing = frameCtx.getImageData(0, 0, decoded.width, decoded.height);
    compositeGifFramePatch(existing.data, decoded.width, frame);
    frameCtx.putImageData(existing, 0, 0);
    previousFrame = frame;
  }
}

/** Draw the final composited frame without playing the animation. */
export function drawSkinGifLastFrame(
  canvas: HTMLCanvasElement,
  decoded: DecodedSkinGif,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || decoded.frames.length === 0) return;

  canvas.width = decoded.width;
  canvas.height = decoded.height;

  const frameBuffer = createGifFrameCanvas(decoded);
  if (!frameBuffer) return;

  compositeGifFramesToCanvas(frameBuffer.ctx, decoded);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(frameBuffer.canvas, 0, 0);
}

export function playSkinGifOnCanvas(
  canvas: HTMLCanvasElement,
  decoded: DecodedSkinGif,
  options: SkinGifPlaybackOptions = {},
): SkinGifPlaybackHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx || decoded.frames.length === 0) {
    return { stop: () => {} };
  }

  canvas.width = decoded.width;
  canvas.height = decoded.height;

  const frameCanvas = document.createElement("canvas");
  frameCanvas.width = decoded.width;
  frameCanvas.height = decoded.height;
  const frameCtx = frameCanvas.getContext("2d");
  if (!frameCtx) {
    return { stop: () => {} };
  }

  const playbackRate = resolveGifPlaybackRate(decoded, options);
  const loopCount = resolveGifLoopCount(decoded, options);

  let frameIndex = 0;
  let completedLoops = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let previousFrame: ParsedFrame | null = null;
  let firstFrameDrawn = false;

  const stop = () => {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const applyDisposal = () => {
    if (!previousFrame) return;
    if (previousFrame.disposalType === 2) {
      frameCtx.clearRect(
        previousFrame.dims.left,
        previousFrame.dims.top,
        previousFrame.dims.width,
        previousFrame.dims.height,
      );
    }
  };

  const blitFramePatch = (frame: ParsedFrame) => {
    const existing = frameCtx.getImageData(
      0,
      0,
      frameCanvas.width,
      frameCanvas.height,
    );
    compositeGifFramePatch(existing.data, frameCanvas.width, frame);
    frameCtx.putImageData(existing, 0, 0);
  };

  const drawFrame = (frame: ParsedFrame) => {
    applyDisposal();
    blitFramePatch(frame);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(frameCanvas, 0, 0);
    if (!firstFrameDrawn) {
      firstFrameDrawn = true;
      options.onFirstFrameDrawn?.();
    }
    previousFrame = frame;
  };

  const scheduleNext = () => {
    if (stopped) return;

    const frame = decoded.frames[frameIndex];
    drawFrame(frame);

    timer = setTimeout(
      () => {
        timer = null;
        if (stopped) return;

        frameIndex += 1;
        if (frameIndex >= decoded.frames.length) {
          options.onLoopComplete?.(completedLoops);
          completedLoops += 1;
          if (!shouldContinueLoop(loopCount, completedLoops)) {
            stop();
            return;
          }
          frameIndex = 0;
          previousFrame = null;
          frameCtx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);
        }

        scheduleNext();
      },
      Math.max(0, frame.delay / playbackRate),
    );
  };

  scheduleNext();
  return { stop };
}
