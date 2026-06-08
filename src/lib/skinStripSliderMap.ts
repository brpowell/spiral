function isTransparent(r: number, g: number, b: number, a: number): boolean {
  if (a < 128) return true;
  return r === 255 && g === 0 && b === 255;
}

function colorKey(r: number, g: number, b: number): string {
  return `${r},${g},${b}`;
}

export interface StripSliderPositionMap {
  width: number;
  height: number;
  /** Sample map pixel → frame index (0..frameCount-1), or -1 if transparent. */
  frameAt(x: number, y: number): number;
}

export async function loadStripSliderPositionMap(
  url: string,
  frameCount: number,
  direction: "horizontal" | "vertical",
): Promise<StripSliderPositionMap | null> {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(image, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const colorStats = new Map<string, { sumX: number; sumY: number; count: number }>();

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
  source: "map" | "linear";
}

export function sampleStripSliderPointer(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  positionMapData: StripSliderPositionMap | null,
  frameCount: number,
  direction: "horizontal" | "vertical",
  invert: boolean,
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
  let source: "map" | "linear" = "linear";
  if (positionMapData) {
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
  }

  const frame = invertStripFrame(raw, frameCount, invert);
  return {
    rawFrame: raw,
    frame,
    ratio: frameToRatio(frame, frameCount),
    mapX,
    mapY,
    source,
  };
}
