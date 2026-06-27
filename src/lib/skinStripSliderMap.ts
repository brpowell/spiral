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
}

function isDialStripSliderMap(
  colorCount: number,
  frameCount: number,
  colorKeys: Iterable<string>,
): boolean {
  if (colorCount <= frameCount * 1.5) return false;
  let grayscaleLike = 0;
  for (const key of colorKeys) {
    const [r, g, b] = key.split(",").map(Number);
    if (Math.abs(r - g) <= 5 && Math.abs(r - b) <= 5) grayscaleLike++;
  }
  return grayscaleLike / colorCount < 0.85;
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
  },
): Promise<StripSliderPositionMap | null> {
  const cacheKey = [
    url,
    frameCount,
    direction,
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

  const isDialMap = isDialStripSliderMap(
    colorStats.size,
    frameCount,
    colorStats.keys(),
  );

  let dialPath: DialPathGeometry | null = null;
  if (
    isDialMap &&
    options?.stripUrl &&
    options.frameWidth &&
    options.frameHeight
  ) {
    dialPath = await loadDialPathFromStrip(
      options.stripUrl,
      options.frameWidth,
      options.frameHeight,
      frameCount,
    );
  }

  if (dialPath) {
    return {
      width,
      height,
      dialPath,
      frameAt() {
        return -1;
      },
    };
  }

  const ranked = [...colorStats.entries()]
    .map(([key, stat]) => ({
      key,
      avgX: stat.sumX / stat.count,
      avgY: stat.sumY / stat.count,
    }))
    .sort((a, b) =>
      direction === "vertical" ? b.avgY - a.avgY : a.avgX - b.avgX,
    );

  const colorToFrame = new Map<string, number>();
  ranked.forEach((entry, index) => {
    const frame = Math.min(index, frameCount - 1);
    colorToFrame.set(entry.key, frame);
  });

  return {
    width,
    height,
    frameAt(x: number, y: number) {
      const px = Math.min(Math.max(Math.floor(x), 0), width - 1);
      const py = Math.min(Math.max(Math.floor(y), 0), height - 1);
      const i = (py * width + px) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (isTransparent(r, g, b, a)) return -1;
      return colorToFrame.get(colorKey(r, g, b)) ?? -1;
    },
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

export function invertStripFrame(
  frame: number,
  frameCount: number,
  invert: boolean,
): number {
  if (!invert || frameCount <= 1) return frame;
  return frameCount - 1 - frame;
}

export interface StripSliderPointerSample {
  rawFrame: number;
  frame: number;
  ratio: number;
  mapX: number;
  mapY: number;
  source: "map" | "dial" | "linear";
}

export function sampleStripSliderPointer(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  positionMapData: StripSliderPositionMap | null,
  frameCount: number,
  direction: "horizontal" | "vertical",
  invert: boolean,
  anchorFrame?: number,
): StripSliderPointerSample {
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
    if (raw >= 0) source = "map";
  }
  if (raw < 0) {
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

  const frame = invertStripFrame(
    raw,
    frameCount,
    invert && !positionMapData?.dialPath,
  );
  return {
    rawFrame: raw,
    frame,
    ratio: frameToRatio(frame, frameCount),
    mapX,
    mapY,
    source,
  };
}
