/**
 * Memory / DoS budgets for sandboxed VizRenderers.
 *
 * Viewport sizes are clamped (keep rendering). Clear abuse — oversized audio
 * transfers, pack-grown canvases, huge returned bitmaps, giant entry source —
 * fails hard so the host can terminate the worker.
 */

/** Cap devicePixelRatio used for the OffscreenCanvas backing store. */
export const MAX_VIZ_DPR = 2.5;

/** CSS viewport clamps before applying DPR. */
export const MAX_VIZ_CSS_WIDTH = 3840;
export const MAX_VIZ_CSS_HEIGHT = 2160;

/** Backing-store pixel clamps (RGBA ≈ 4 bytes/pixel). */
export const MAX_VIZ_PIXEL_WIDTH = 2560;
export const MAX_VIZ_PIXEL_HEIGHT = 1440;
/** ~3.7MP → ~14.8MB per buffer; host + worker + bitmap stay bounded. */
export const MAX_VIZ_PIXEL_AREA = MAX_VIZ_PIXEL_WIDTH * MAX_VIZ_PIXEL_HEIGHT;

/**
 * Analyser fftSize is 256 today; allow headroom without permitting multi-MB
 * transferable audio frames.
 */
export const MAX_AUDIO_FREQUENCY_BINS = 512;
export const MAX_AUDIO_WAVEFORM_SAMPLES = 2048;

/** Pack entry JS size cap (host-supplied source string). */
export const MAX_RENDERER_SOURCE_BYTES = 512 * 1024;

export interface VizRenderSize {
  width: number;
  height: number;
  dpr: number;
  pixelWidth: number;
  pixelHeight: number;
}

function finitePositive(n: number, fallback: number): number {
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Clamp CSS size + DPR so the backing store stays within pixel budgets.
 * Layout can still be larger; we render at the capped pixel size.
 */
export function clampVizRenderSize(
  width: number,
  height: number,
  dpr: number,
): VizRenderSize {
  const cssW = Math.min(
    MAX_VIZ_CSS_WIDTH,
    Math.max(1, finitePositive(width, 1)),
  );
  const cssH = Math.min(
    MAX_VIZ_CSS_HEIGHT,
    Math.max(1, finitePositive(height, 1)),
  );
  let safeDpr = Math.min(MAX_VIZ_DPR, Math.max(0.5, finitePositive(dpr, 1)));

  let pixelWidth = Math.max(1, Math.floor(cssW * safeDpr));
  let pixelHeight = Math.max(1, Math.floor(cssH * safeDpr));

  const widthScale = MAX_VIZ_PIXEL_WIDTH / pixelWidth;
  const heightScale = MAX_VIZ_PIXEL_HEIGHT / pixelHeight;
  const areaScale = Math.sqrt(MAX_VIZ_PIXEL_AREA / (pixelWidth * pixelHeight));
  const scale = Math.min(1, widthScale, heightScale, areaScale);
  if (scale < 1) {
    safeDpr *= scale;
    pixelWidth = Math.max(1, Math.floor(cssW * safeDpr));
    pixelHeight = Math.max(1, Math.floor(cssH * safeDpr));
  }

  // Final integer clamp in case of float edge cases.
  pixelWidth = Math.min(MAX_VIZ_PIXEL_WIDTH, pixelWidth);
  pixelHeight = Math.min(MAX_VIZ_PIXEL_HEIGHT, pixelHeight);
  if (pixelWidth * pixelHeight > MAX_VIZ_PIXEL_AREA) {
    const areaFix = Math.sqrt(MAX_VIZ_PIXEL_AREA / (pixelWidth * pixelHeight));
    pixelWidth = Math.max(1, Math.floor(pixelWidth * areaFix));
    pixelHeight = Math.max(1, Math.floor(pixelHeight * areaFix));
    safeDpr = Math.min(safeDpr, pixelWidth / cssW, pixelHeight / cssH);
  }

  return {
    width: cssW,
    height: cssH,
    dpr: safeDpr,
    pixelWidth,
    pixelHeight,
  };
}

export function isWithinPixelBudget(
  pixelWidth: number,
  pixelHeight: number,
): boolean {
  if (
    !Number.isFinite(pixelWidth) ||
    !Number.isFinite(pixelHeight) ||
    pixelWidth < 0 ||
    pixelHeight < 0
  ) {
    return false;
  }
  return (
    pixelWidth <= MAX_VIZ_PIXEL_WIDTH &&
    pixelHeight <= MAX_VIZ_PIXEL_HEIGHT &&
    pixelWidth * pixelHeight <= MAX_VIZ_PIXEL_AREA
  );
}

export function assertPixelBudget(
  label: string,
  pixelWidth: number,
  pixelHeight: number,
): void {
  if (!isWithinPixelBudget(pixelWidth, pixelHeight)) {
    throw new Error(
      `[viz-sandbox] ${label} exceeded pixel budget (${pixelWidth}x${pixelHeight})`,
    );
  }
}

export function assertCanvasWithinBudget(
  canvas: Pick<OffscreenCanvas, "width" | "height">,
): void {
  assertPixelBudget("canvas", canvas.width, canvas.height);
}

export function assertAudioBuffersWithinBudget(
  frequencies: ArrayLike<number>,
  waveform: ArrayLike<number>,
): void {
  if (frequencies.length > MAX_AUDIO_FREQUENCY_BINS) {
    throw new Error(
      `[viz-sandbox] frequency buffer exceeded budget (${frequencies.length} > ${MAX_AUDIO_FREQUENCY_BINS})`,
    );
  }
  if (waveform.length > MAX_AUDIO_WAVEFORM_SAMPLES) {
    throw new Error(
      `[viz-sandbox] waveform buffer exceeded budget (${waveform.length} > ${MAX_AUDIO_WAVEFORM_SAMPLES})`,
    );
  }
}

export function assertRendererSourceWithinBudget(source: string): void {
  // UTF-16 code units ≈ upper bound on retained string memory in JS engines.
  if (source.length > MAX_RENDERER_SOURCE_BYTES) {
    throw new Error(
      `[viz-sandbox] renderer source exceeded budget (${source.length} > ${MAX_RENDERER_SOURCE_BYTES} chars)`,
    );
  }
}
