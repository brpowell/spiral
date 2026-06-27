import { decompressFrames, parseGIF, type ParsedFrame, type ParsedGif } from "gifuct-js";

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
      .then(decodeSkinGif);
    decodeCache.set(url, pending);
  }
  return pending;
}

export function clearSkinGifDecodeCache(): void {
  decodeCache.clear();
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

function shouldContinueLoop(
  loopCount: number | null,
  completedLoops: number,
): boolean {
  if (loopCount === null) return completedLoops < 1;
  if (loopCount === 0) return true;
  return completedLoops <= loopCount;
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
  const loopCount = options.loopForever ? 0 : decoded.loopCount;

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

  const drawFrame = (frame: ParsedFrame) => {
    applyDisposal();
    const patch = new ImageData(
      new Uint8ClampedArray(frame.patch),
      frame.dims.width,
      frame.dims.height,
    );
    frameCtx.putImageData(patch, frame.dims.left, frame.dims.top);
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

    timer = setTimeout(() => {
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
    }, Math.max(0, frame.delay / playbackRate));
  };

  scheduleNext();
  return { stop };
}
