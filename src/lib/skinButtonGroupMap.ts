export interface ButtonGroupHitRegion {
  colorKey: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ButtonGroupPositionMap {
  width: number;
  height: number;
  /** Bounding boxes per mapping color for transparent passthrough between buttons. */
  regions: ButtonGroupHitRegion[];
  /** Alpha masks keyed by mapping color (`"r,g,b"`) for per-button hover/pressed overlays. */
  colorMasks: Map<string, string>;
  /**
   * Resolve the mapping-color key (`"r,g,b"`) under a point, restricted to
   * `validKeys`. Returns the element-identifying color key (not an action) so
   * groups that repeat an action with different payloads stay distinct.
   */
  keyAt(x: number, y: number, validKeys: Set<string>): string | null;
}

export function parseMappingColor(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim().replace(/^#/, "");
  if (hex.length !== 6) return null;
  const value = Number.parseInt(hex, 16);
  if (Number.isNaN(value)) return null;
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

function colorKey(r: number, g: number, b: number): string {
  return `${r},${g},${b}`;
}

function isTransparent(r: number, g: number, b: number, a: number): boolean {
  if (a < 128) return true;
  return r === 255 && g === 0 && b === 255;
}

function buildRegions(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ButtonGroupHitRegion[] {
  const boxes = new Map<
    string,
    { minX: number; minY: number; maxX: number; maxY: number }
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
      const box = boxes.get(key) ?? {
        minX: x,
        minY: y,
        maxX: x,
        maxY: y,
      };
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
      boxes.set(key, box);
    }
  }

  return [...boxes.entries()].map(([colorKey, box]) => ({
    colorKey,
    x: box.minX,
    y: box.minY,
    w: box.maxX - box.minX + 1,
    h: box.maxY - box.minY + 1,
  }));
}

/** Build per-color alpha masks from WMP mappingImage pixel data. */
function buildColorMasks(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Map<string, string> {
  const masks = new Map<string, string>();

  for (const key of collectMapColorKeys(data, width, height)) {
    const alpha = maskAlphaForColor(data, width, height, key);
    const maskData = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < alpha.length; i++) {
      const o = i * 4;
      maskData[o] = 255;
      maskData[o + 1] = 255;
      maskData[o + 2] = 255;
      maskData[o + 3] = alpha[i];
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.putImageData(new ImageData(maskData, width, height), 0, 0);
    masks.set(key, canvas.toDataURL("image/png"));
  }

  return masks;
}

function collectMapColorKeys(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string[] {
  const colorKeys = new Set<string>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (isTransparent(r, g, b, a)) continue;
      colorKeys.add(colorKey(r, g, b));
    }
  }

  return [...colorKeys];
}

function maskAlphaForColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  targetColorKey: string,
): Uint8ClampedArray {
  const [r, g, b] = targetColorKey.split(",").map(Number);
  const alpha = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const pr = data[i];
      const pg = data[i + 1];
      const pb = data[i + 2];
      const pa = data[i + 3];
      const match =
        pr === r && pg === g && pb === b && !isTransparent(pr, pg, pb, pa);
      alpha[y * width + x] = match ? 255 : 0;
    }
  }

  return alpha;
}

export async function loadButtonGroupPositionMap(
  url: string,
): Promise<ButtonGroupPositionMap | null> {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(image, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const regions = buildRegions(data, width, height);
  const colorMasks = buildColorMasks(data, width, height);

  const colorAt = (x: number, y: number): string | null => {
    const px = Math.min(Math.max(Math.floor(x), 0), width - 1);
    const py = Math.min(Math.max(Math.floor(y), 0), height - 1);
    const i = (py * width + px) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (isTransparent(r, g, b, a)) return null;
    return colorKey(r, g, b);
  };

  return {
    width,
    height,
    regions,
    colorMasks,
    keyAt(x: number, y: number, validKeys: Set<string>) {
      const px = Math.min(Math.max(Math.floor(x), 0), width - 1);
      const py = Math.min(Math.max(Math.floor(y), 0), height - 1);

      const color = colorAt(px, py);
      if (color && validKeys.has(color)) return color;

      // Fallback when pointer lands just outside anti-aliased map edges.
      let best: { colorKey: string; area: number } | null = null;
      for (const region of regions) {
        if (
          px >= region.x &&
          px < region.x + region.w &&
          py >= region.y &&
          py < region.y + region.h
        ) {
          if (!validKeys.has(region.colorKey)) continue;
          const area = region.w * region.h;
          if (!best || area < best.area) {
            best = { colorKey: region.colorKey, area };
          }
        }
      }

      return best?.colorKey ?? null;
    },
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch button group map: ${response.status}`);
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
            reject(new Error(`Failed to decode button group map: ${url}`));
          };
          img.src = objectUrl;
        }),
    );
}
