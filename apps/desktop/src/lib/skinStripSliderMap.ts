function isTransparent(r: number, g: number, b: number, a: number): boolean {
  if (a < 128) return true;
  return r === 255 && g === 0 && b === 255;
}

function colorKey(r: number, g: number, b: number): string {
  return `${r},${g},${b}`;
}

/** Clockwise notch path for WMP circular customSlider dials. */
export interface DialPathGeometry {
  cx: number;
  cy: number;
  /** Unwrapped radians at frame 0 (minimum value). */
  pathStart: number;
  /** Unwrapped radians at max frame (clockwise from pathStart through top). */
  pathEnd: number;
}

export interface StripSliderPositionMap {
  width: number;
  height: number;
  /** Full-ring dial path derived from the filmstrip pointer positions. */
  dialPath?: DialPathGeometry;
  /** Sample map pixel → frame index (0..frameCount-1), or -1 if transparent. */
  frameAt(x: number, y: number): number;
  /**
   * Nearest mapped frame for a pixel, including transparent/chroma-key
   * samples (clamped to the map). −1 only when the map has no hit pixels.
   */
  nearestFrameAt?(x: number, y: number): number;
}

function isGrayscaleColor(r: number, g: number, b: number): boolean {
  return Math.abs(r - g) <= 5 && Math.abs(r - b) <= 5;
}

function grayscaleShare(colorKeys: Iterable<string>): number {
  let total = 0;
  let grayscaleLike = 0;
  for (const key of colorKeys) {
    total += 1;
    const [r, g, b] = key.split(",").map(Number);
    if (isGrayscaleColor(r, g, b)) grayscaleLike++;
  }
  return total === 0 ? 0 : grayscaleLike / total;
}

function isDialStripSliderMap(
  colorCount: number,
  frameCount: number,
  colorKeys: Iterable<string>,
): boolean {
  if (colorCount <= frameCount * 1.5) return false;
  return grayscaleShare(colorKeys) < 0.85;
}

/** WMP `positionImage` ramps: black = first frame, white = last (unless inverted). */
function isGrayscaleRampMap(colorKeys: Iterable<string>): boolean {
  return grayscaleShare(colorKeys) >= 0.85;
}

function pixelLuminance(r: number, g: number, b: number): number {
  return (r + g + b) / 3;
}

function luminanceToFrame(
  r: number,
  g: number,
  b: number,
  frameCount: number,
  mapFrames: StripSliderMapFrames,
  minLum: number,
  maxLum: number,
): number {
  if (frameCount <= 1) return 0;
  const span = maxLum - minLum || 1;
  const lum = (pixelLuminance(r, g, b) - minLum) / span;
  const t = mapFrames === "descending" ? 1 - lum : lum;
  return Math.round(Math.min(1, Math.max(0, t)) * (frameCount - 1));
}

function hasTransparentNeighbor(
  x: number,
  y: number,
  width: number,
  height: number,
  frameAt: (x: number, y: number) => number,
): boolean {
  if (x > 0 && frameAt(x - 1, y) < 0) return true;
  if (x + 1 < width && frameAt(x + 1, y) < 0) return true;
  if (y > 0 && frameAt(x, y - 1) < 0) return true;
  if (y + 1 < height && frameAt(x, y + 1) < 0) return true;
  return false;
}

function withNearestFrameLookup(
  width: number,
  height: number,
  frameAt: (x: number, y: number) => number,
): Pick<StripSliderPositionMap, "frameAt" | "nearestFrameAt"> {
  const nearest = new Int16Array(width * height);
  nearest.fill(-1);
  const interior: number[] = [];
  const mapped: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const frame = frameAt(x, y);
      if (frame < 0) continue;
      const idx = y * width + x;
      mapped.push(idx);
      if (!hasTransparentNeighbor(x, y, width, height, frameAt)) {
        nearest[idx] = frame;
        interior.push(idx);
      }
    }
  }
  // Prefer the stroke interior so anti-aliased tip halos do not become the
  // "nearest" end while dragging past a curved track.
  const queue = interior.length > 0 ? interior : mapped;
  if (interior.length === 0) {
    for (const idx of mapped) {
      const x = idx % width;
      const y = (idx - x) / width;
      nearest[idx] = frameAt(x, y);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % width;
    const y = (idx - x) / width;
    const frame = nearest[idx];
    if (x > 0 && nearest[idx - 1] < 0) {
      nearest[idx - 1] = frame;
      queue.push(idx - 1);
    }
    if (x + 1 < width && nearest[idx + 1] < 0) {
      nearest[idx + 1] = frame;
      queue.push(idx + 1);
    }
    if (y > 0 && nearest[idx - width] < 0) {
      nearest[idx - width] = frame;
      queue.push(idx - width);
    }
    if (y + 1 < height && nearest[idx + width] < 0) {
      nearest[idx + width] = frame;
      queue.push(idx + width);
    }
  }

  return {
    frameAt,
    nearestFrameAt(x: number, y: number) {
      const px = Math.min(Math.max(Math.floor(x), 0), width - 1);
      const py = Math.min(Math.max(Math.floor(y), 0), height - 1);
      return nearest[py * width + px];
    },
  };
}

function pointerAngleForStripFrame(
  data: Uint8ClampedArray,
  stripWidth: number,
  frameWidth: number,
  frameHeight: number,
  frameIndex: number,
  cx: number,
  cy: number,
): number | null {
  let bestX = -1;
  let bestY = -1;
  let bestScore = -1;
  const frameLeft = frameIndex * frameWidth;

  for (let y = 0; y < frameHeight; y++) {
    for (let x = frameLeft; x < frameLeft + frameWidth; x++) {
      const i = (y * stripWidth + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (isTransparent(r, g, b, a)) continue;
      const score = b - r;
      if (score <= bestScore) continue;
      bestScore = score;
      bestX = x - frameLeft;
      bestY = y;
    }
  }

  if (bestScore < 0) return null;
  return Math.atan2(bestY - cy, bestX - cx);
}

export function detectDialPathFromStripPixels(
  data: Uint8ClampedArray,
  stripWidth: number,
  frameWidth: number,
  frameHeight: number,
  frameCount: number,
): DialPathGeometry | null {
  const cx = (frameWidth - 1) / 2;
  const cy = (frameHeight - 1) / 2;
  const frameAngles: number[] = [];

  for (let frame = 0; frame < frameCount; frame++) {
    const angle = pointerAngleForStripFrame(
      data,
      stripWidth,
      frameWidth,
      frameHeight,
      frame,
      cx,
      cy,
    );
    if (angle === null) return null;
    frameAngles.push(angle);
  }

  const pathStart = frameAngles[0];
  const unwrapped = [pathStart];
  for (let i = 1; i < frameAngles.length; i++) {
    let angle = frameAngles[i];
    while (angle <= unwrapped[i - 1]) angle += Math.PI * 2;
    unwrapped.push(angle);
  }

  return {
    cx,
    cy,
    pathStart,
    pathEnd: unwrapped[frameCount - 1],
  };
}

function unwrapDialAngle(
  angle: number,
  dialPath: DialPathGeometry,
): number | null {
  for (let n = 0; n <= 2; n++) {
    const unwrapped = angle + n * Math.PI * 2;
    if (unwrapped >= dialPath.pathStart && unwrapped <= dialPath.pathEnd) {
      return unwrapped;
    }
  }
  return null;
}

export function frameFromDialAngle(
  angle: number,
  dialPath: DialPathGeometry,
  frameCount: number,
  anchorFrame?: number,
): number {
  if (frameCount <= 1) return 0;
  const span = dialPath.pathEnd - dialPath.pathStart;
  if (span <= 0) return 0;

  const unwrapped = unwrapDialAngle(angle, dialPath);
  if (unwrapped === null) {
    if (anchorFrame !== undefined) {
      return Math.min(Math.max(anchorFrame, 0), frameCount - 1);
    }
    return nearestDialEndpointFrame(angle, dialPath, frameCount);
  }

  const t = (unwrapped - dialPath.pathStart) / span;
  return Math.round(Math.max(0, Math.min(1, t)) * (frameCount - 1));
}

function nearestDialEndpointFrame(
  angle: number,
  dialPath: DialPathGeometry,
  frameCount: number,
): number {
  const candidates = [angle, angle + Math.PI * 2, angle + Math.PI * 4];
  let nearest = dialPath.pathStart;
  let nearestDist = Infinity;
  for (const candidate of candidates) {
    for (const endpoint of [dialPath.pathStart, dialPath.pathEnd]) {
      const dist = Math.abs(candidate - endpoint);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = endpoint;
      }
    }
  }
  return nearest <= dialPath.pathStart ? 0 : frameCount - 1;
}

export async function loadStripSliderPositionMap(
  url: string,
  frameCount: number,
  direction: "horizontal" | "vertical",
  options?: {
    stripUrl?: string;
    frameWidth?: number;
    frameHeight?: number;
    mapFrames?: StripSliderMapFrames;
  },
): Promise<StripSliderPositionMap | null> {
  const cacheKey = [
    url,
    frameCount,
    direction,
    options?.mapFrames ?? "ascending",
    options?.stripUrl ?? "",
    options?.frameWidth ?? "",
    options?.frameHeight ?? "",
  ].join("|");

  const cached = positionMapCache.get(cacheKey);
  if (cached) return cached;

  const promise = loadStripSliderPositionMapInner(
    url,
    frameCount,
    direction,
    options,
  );
  positionMapCache.set(cacheKey, promise);
  return promise;
}

const positionMapCache = new Map<
  string,
  Promise<StripSliderPositionMap | null>
>();

async function loadStripSliderPositionMapInner(
  url: string,
  frameCount: number,
  direction: "horizontal" | "vertical",
  options?: {
    stripUrl?: string;
    frameWidth?: number;
    frameHeight?: number;
    mapFrames?: StripSliderMapFrames;
  },
): Promise<StripSliderPositionMap | null> {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(image, 0, 0);
  const { data, width, height } = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  let dialPath: DialPathGeometry | null = null;
  if (options?.stripUrl && options.frameWidth && options.frameHeight) {
    const colorKeys = collectDistinctColorKeys(data);
    if (isDialStripSliderMap(colorKeys.size, frameCount, colorKeys)) {
      dialPath = await loadDialPathFromStrip(
        options.stripUrl,
        options.frameWidth,
        options.frameHeight,
        frameCount,
      );
    }
  }

  return buildStripSliderPositionMapFromPixels(
    data,
    width,
    height,
    frameCount,
    direction,
    dialPath,
    options?.mapFrames ?? "ascending",
  );
}

function collectDistinctColorKeys(data: Uint8ClampedArray): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (isTransparent(r, g, b, a)) continue;
    keys.add(colorKey(r, g, b));
  }
  return keys;
}

/** Build a position map from RGBA pixels (shared by runtime loader and tests). */
export function buildStripSliderPositionMapFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  frameCount: number,
  direction: "horizontal" | "vertical",
  dialPath?: DialPathGeometry | null,
  mapFrames: StripSliderMapFrames = "ascending",
): StripSliderPositionMap | null {
  const colorStats = new Map<
    string,
    { sumX: number; sumY: number; count: number }
  >();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (isTransparent(r, g, b, a)) continue;

      const key = colorKey(r, g, b);
      const stat = colorStats.get(key) ?? { sumX: 0, sumY: 0, count: 0 };
      stat.sumX += x;
      stat.sumY += y;
      stat.count += 1;
      colorStats.set(key, stat);
    }
  }

  if (colorStats.size === 0) return null;

  if (dialPath) {
    return {
      width,
      height,
      dialPath,
      frameAt() {
        return -1;
      },
      nearestFrameAt() {
        return -1;
      },
    };
  }

  const colorEntries = [...colorStats.entries()].map(([key, stat]) => ({
    key,
    avgX: stat.sumX / stat.count,
    avgY: stat.sumY / stat.count,
  }));

  // WMP customSlider positionImage maps grayscale ramps by luminance
  // (black = first frame, white = last). Spatial centroids are wrong on
  // curved tracks: the leftmost anti-aliased gray becomes "min" while the
  // true black tip sits inward and never reaches 0. Non-gray maps still
  // use position along the interaction axis (Xbox/T3-style color keys).
  const useLuminance = isGrayscaleRampMap(colorStats.keys());
  const positions = colorEntries.map((e) =>
    direction === "vertical" ? e.avgY : e.avgX,
  );
  const minPos = Math.min(...positions);
  const maxPos = Math.max(...positions);
  let minLum = 255;
  let maxLum = 0;
  if (useLuminance) {
    for (const key of colorStats.keys()) {
      const [r, g, b] = key.split(",").map(Number);
      const lum = pixelLuminance(r, g, b);
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
    }
  }

  const colorToFrame = new Map<string, number>();
  if (!useLuminance) {
    colorEntries.forEach((entry) => {
      const pos = direction === "vertical" ? entry.avgY : entry.avgX;
      const t = mapPositionToFrameT(pos, minPos, maxPos, direction, mapFrames);
      const frame = Math.round(Math.min(1, Math.max(0, t)) * (frameCount - 1));
      colorToFrame.set(entry.key, frame);
    });
  }

  const frameAt = (x: number, y: number): number => {
    const px = Math.min(Math.max(Math.floor(x), 0), width - 1);
    const py = Math.min(Math.max(Math.floor(y), 0), height - 1);
    const i = (py * width + px) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (isTransparent(r, g, b, a)) return -1;
    if (useLuminance) {
      return luminanceToFrame(r, g, b, frameCount, mapFrames, minLum, maxLum);
    }
    return colorToFrame.get(colorKey(r, g, b)) ?? -1;
  };

  return {
    width,
    height,
    ...withNearestFrameLookup(width, height, frameAt),
  };
}

async function loadDialPathFromStrip(
  stripUrl: string,
  frameWidth: number,
  frameHeight: number,
  frameCount: number,
): Promise<DialPathGeometry | null> {
  const image = await loadImage(stripUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(image, 0, 0);
  const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return detectDialPathFromStripPixels(
    data,
    width,
    frameWidth,
    frameHeight,
    frameCount,
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch position map: ${response.status}`);
      }
      return response.blob();
    })
    .then(
      (blob) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const objectUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(img);
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error(`Failed to decode position map: ${url}`));
          };
          img.src = objectUrl;
        }),
    );
}

export function inferStripSliderStripLayout(
  naturalWidth: number,
  naturalHeight: number,
  frameWidth: number,
  frameHeight: number,
  frameCount: number,
): "horizontal" | "vertical" {
  const horizontalSpan = frameWidth * frameCount;
  const verticalSpan = frameHeight * frameCount;
  const horizontalDelta = Math.abs(naturalWidth - horizontalSpan);
  const verticalDelta = Math.abs(naturalHeight - verticalSpan);
  return verticalDelta < horizontalDelta ? "vertical" : "horizontal";
}

export function linearFrameFromPointer(
  x: number,
  y: number,
  width: number,
  height: number,
  frameCount: number,
  direction: "horizontal" | "vertical",
): number {
  const ratio =
    direction === "vertical"
      ? 1 - Math.min(Math.max(y / height, 0), 1)
      : Math.min(Math.max(x / width, 0), 1);
  return Math.round(ratio * (frameCount - 1));
}

export function frameToRatio(frame: number, frameCount: number): number {
  if (frameCount <= 1) return 0;
  return frame / (frameCount - 1);
}

export type StripSliderValueFrames = "ascending" | "descending";

export type StripSliderMapFrames = "ascending" | "descending";

function mapPositionToFrameT(
  pos: number,
  minPos: number,
  maxPos: number,
  direction: "horizontal" | "vertical",
  mapFrames: StripSliderMapFrames,
): number {
  const span = maxPos - minPos || 1;
  const ascending =
    direction === "vertical" ? (maxPos - pos) / span : (pos - minPos) / span;
  if (mapFrames === "descending") {
    return 1 - ascending;
  }
  return ascending;
}

/** Normalized value 0…1 → strip frame index for display. */
export function ratioToStripFrame(
  ratio: number,
  frameCount: number,
  valueFrames: StripSliderValueFrames = "ascending",
): number {
  if (frameCount <= 1) return 0;
  const clamped = Math.min(Math.max(ratio, 0), 1);
  const ascendingFrame = Math.round(clamped * (frameCount - 1));
  if (valueFrames === "descending") {
    return frameCount - 1 - ascendingFrame;
  }
  return ascendingFrame;
}

/** Strip frame index → normalized value 0…1. */
export function stripFrameToRatio(
  frame: number,
  frameCount: number,
  valueFrames: StripSliderValueFrames = "ascending",
): number {
  if (frameCount <= 1) return 0;
  const clamped = Math.min(Math.max(frame, 0), frameCount - 1);
  const ascendingRatio = clamped / (frameCount - 1);
  if (valueFrames === "descending") {
    return 1 - ascendingRatio;
  }
  return ascendingRatio;
}

export interface StripSliderPointerSample {
  rawFrame: number;
  frame: number;
  ratio: number;
  mapX: number;
  mapY: number;
  source: "map" | "dial" | "linear";
}

export type StripSliderOffMapFallback = "none" | "nearest";

export function sampleStripSliderPointer(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  positionMapData: StripSliderPositionMap | null,
  frameCount: number,
  direction: "horizontal" | "vertical",
  valueFrames: StripSliderValueFrames = "ascending",
  anchorFrame?: number,
  offMapFallback: StripSliderOffMapFallback = "none",
): StripSliderPointerSample | null {
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const mapX = positionMapData
    ? (localX / rect.width) * positionMapData.width
    : localX;
  const mapY = positionMapData
    ? (localY / rect.height) * positionMapData.height
    : localY;

  let raw = -1;
  let source: StripSliderPointerSample["source"] = "linear";
  if (positionMapData?.dialPath) {
    const angle = Math.atan2(
      mapY - positionMapData.dialPath.cy,
      mapX - positionMapData.dialPath.cx,
    );
    raw = frameFromDialAngle(
      angle,
      positionMapData.dialPath,
      frameCount,
      anchorFrame,
    );
    source = "dial";
  } else if (positionMapData) {
    raw = positionMapData.frameAt(mapX, mapY);
    if (raw >= 0) {
      source = "map";
    } else if (offMapFallback === "nearest") {
      raw = positionMapData.nearestFrameAt?.(mapX, mapY) ?? -1;
      if (raw >= 0) source = "map";
    }
  }
  if (raw < 0) {
    if (positionMapData && !positionMapData.dialPath) {
      return null;
    }
    raw = linearFrameFromPointer(
      localX,
      localY,
      rect.width,
      rect.height,
      frameCount,
      direction,
    );
    source = "linear";
  }

  const ratio = positionMapData?.dialPath
    ? frameToRatio(raw, frameCount)
    : stripFrameToRatio(raw, frameCount, valueFrames);
  return {
    rawFrame: raw,
    frame: raw,
    ratio,
    mapX,
    mapY,
    source,
  };
}
