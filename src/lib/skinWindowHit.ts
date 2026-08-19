import type { LayoutNode } from "../types/skin";

/**
 * How a canvas bounds box participates in OS click-through.
 *
 * `artwork` — bitmap/gif/primitive decorations; only opaque pixels keep the
 *   window interactive (Headspace's head silhouette).
 * `group` — layout `subview` wrappers. Empty group space is ignored so ear /
 *   drawer clusters don’t create phantom hit rects. A painted background still
 *   counts as solid.
 * `control` — buttons, sliders, visualizers, playlists, button groups, etc.
 *   The authored box stays interactive so controls never fall through to the OS.
 */
export type SkinWindowHitKind = "artwork" | "group" | "control";

export const SKIN_WINDOW_HIT_ATTR = "data-skin-window-hit";

const SKIN_WINDOW_HIT_QUERY = [
  ".skin-bounds",
  ".skin-tiled-frame__tile",
  ".skin-tiled-frame__content",
].join(", ");

/** Anti-aliased fringe stays hittable; fully (or nearly) clear pixels pass through. */
export const SKIN_ARTWORK_ALPHA_HIT = 16;

export interface ArtworkAlphaMap {
  width: number;
  height: number;
  alpha: Uint8Array;
}

export interface SkinWindowHitRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type SkinWindowHitSample =
  | { kind: "control"; rect: SkinWindowHitRect }
  | { kind: "group"; rect: SkinWindowHitRect; paints: boolean }
  | { kind: "artwork"; rect: SkinWindowHitRect; opaque: boolean };

const alphaMaps = new Map<string, ArtworkAlphaMap | "loading" | "failed">();

export function resolveSkinWindowHitKind(node: LayoutNode): SkinWindowHitKind {
  if (node.type === "decoration") return "artwork";
  if (node.type === "subview") return "group";
  return "control";
}

export function rectContains(
  rect: SkinWindowHitRect,
  clientX: number,
  clientY: number,
): boolean {
  return (
    clientX >= rect.left &&
    clientX < rect.right &&
    clientY >= rect.top &&
    clientY < rect.bottom
  );
}

export function clientPointToImagePixel(
  rect: SkinWindowHitRect,
  naturalWidth: number,
  naturalHeight: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  if (naturalWidth <= 0 || naturalHeight <= 0) return null;
  if (rect.right <= rect.left || rect.bottom <= rect.top) return null;
  if (!rectContains(rect, clientX, clientY)) return null;
  const x = Math.min(
    naturalWidth - 1,
    Math.max(
      0,
      Math.floor(
        ((clientX - rect.left) / (rect.right - rect.left)) * naturalWidth,
      ),
    ),
  );
  const y = Math.min(
    naturalHeight - 1,
    Math.max(
      0,
      Math.floor(
        ((clientY - rect.top) / (rect.bottom - rect.top)) * naturalHeight,
      ),
    ),
  );
  return { x, y };
}

export function isOpaqueArtworkAlpha(
  map: ArtworkAlphaMap,
  x: number,
  y: number,
  threshold = SKIN_ARTWORK_ALPHA_HIT,
): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.alpha[y * map.width + x] >= threshold;
}

export function alphaMapFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ArtworkAlphaMap {
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = data[i * 4 + 3] ?? 0;
  }
  return { width, height, alpha };
}

/** True when any overlapping sample is solid window content. */
export function isPointOverSkinWindowHit(
  clientX: number,
  clientY: number,
  samples: SkinWindowHitSample[],
): boolean {
  for (const sample of samples) {
    if (!rectContains(sample.rect, clientX, clientY)) continue;
    if (sample.kind === "group") {
      if (sample.paints) return true;
      continue;
    }
    if (sample.kind === "artwork") {
      if (sample.opaque) return true;
      continue;
    }
    return true;
  }
  return false;
}

export function cssColorIsVisible(color: string): boolean {
  const value = color.trim().toLowerCase();
  return (
    value !== "" &&
    value !== "transparent" &&
    value !== "rgba(0, 0, 0, 0)" &&
    value !== "rgba(0,0,0,0)"
  );
}

export function clearSkinArtworkAlphaCache(): void {
  alphaMaps.clear();
}

/** Test seam: install a decoded alpha map for a decoration URL. */
export function setSkinArtworkAlphaForTest(
  url: string,
  map: ArtworkAlphaMap | "failed",
): void {
  alphaMaps.set(url, map);
}

/**
 * Sync alpha lookup. Missing maps start a fetch and report `null` so callers
 * can stay conservative (treat as opaque) until decode finishes.
 */
export function getSkinArtworkAlphaSync(url: string): ArtworkAlphaMap | null {
  const entry = alphaMaps.get(url);
  if (entry === "failed" || entry === "loading") return null;
  if (entry) return entry;
  alphaMaps.set(url, "loading");
  void loadArtworkAlpha(url);
  return null;
}

/** Kick off alpha decode for every mounted bitmap decoration. */
export function primeSkinArtworkAlphaFromDom(
  root: ParentNode = document,
): void {
  for (const img of root.querySelectorAll<HTMLImageElement>(
    "img.skin-decoration--bitmap",
  )) {
    const url = img.currentSrc || img.src;
    if (url) getSkinArtworkAlphaSync(url);
  }
}

async function loadArtworkAlpha(url: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      alphaMaps.set(url, "failed");
      return;
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await decodeImage(objectUrl);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx || image.naturalWidth === 0 || image.naturalHeight === 0) {
        alphaMaps.set(url, "failed");
        return;
      }
      ctx.drawImage(image, 0, 0);
      const { data, width, height } = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      alphaMaps.set(url, alphaMapFromRgba(data, width, height));
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    alphaMaps.set(url, "failed");
  }
}

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to decode artwork: ${url}`));
    img.src = url;
  });
}

function clientRect(el: Element): SkinWindowHitRect {
  const rect = el.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function groupBoundsPaints(el: Element): boolean {
  const inner = el.querySelector(":scope > .skin-layout-node--subview");
  const target = inner ?? el;
  return cssColorIsVisible(getComputedStyle(target).backgroundColor);
}

function isOpaqueBitmapAt(
  img: HTMLImageElement,
  clientX: number,
  clientY: number,
): boolean {
  const rect = clientRect(img);
  const url = img.currentSrc || img.src;
  if (!url) return true;
  const map = getSkinArtworkAlphaSync(url);
  if (!map) return true;
  const pixel = clientPointToImagePixel(
    rect,
    map.width,
    map.height,
    clientX,
    clientY,
  );
  if (!pixel) return false;
  return isOpaqueArtworkAlpha(map, pixel.x, pixel.y);
}

function isOpaqueCanvasAt(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): boolean {
  const rect = clientRect(canvas);
  if (canvas.width <= 0 || canvas.height <= 0) return true;
  const pixel = clientPointToImagePixel(
    rect,
    canvas.width,
    canvas.height,
    clientX,
    clientY,
  );
  if (!pixel) return false;
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return true;
    const { data } = ctx.getImageData(pixel.x, pixel.y, 1, 1);
    return (data[3] ?? 0) >= SKIN_ARTWORK_ALPHA_HIT;
  } catch {
    return true;
  }
}

function artworkOpaqueInBounds(
  boundsEl: Element,
  clientX: number,
  clientY: number,
): boolean {
  const bitmaps = boundsEl.querySelectorAll<HTMLImageElement>(
    "img.skin-decoration--bitmap",
  );
  if (bitmaps.length > 0) {
    for (const img of bitmaps) {
      if (isOpaqueBitmapAt(img, clientX, clientY)) return true;
    }
    return false;
  }

  const gifs = boundsEl.querySelectorAll<HTMLCanvasElement>(
    "canvas.skin-decoration--gif",
  );
  if (gifs.length > 0) {
    for (const canvas of gifs) {
      if (isOpaqueCanvasAt(canvas, clientX, clientY)) return true;
    }
    return false;
  }

  // Primitive / CSS decorations fill the authored box.
  if (boundsEl.querySelector(".skin-decoration")) return true;
  // Bitmap still mounting — don’t punch a hole through unloaded artwork.
  return true;
}

/**
 * True when the point lands on skin artwork or controls rather than empty
 * stage / transparent PNG holes.
 *
 * Grouping subviews are skipped unless they paint a background. Decorations
 * sample bitmap alpha so irregular silhouettes (Headspace) click through.
 * Tiled-frame chrome tiles count as solid so aux window title bars (Xbox
 * playlist, T3 about) still drag — those tiles use pointer-events: none so
 * clicks reach the stage drag region, but they are not `.skin-bounds`.
 * Tiled-frame content is also solid: fill controls (playlist, vis) usually
 * omit authored `bounds`, so they never get a `.skin-bounds` wrapper.
 */
export function isOverSkinWindowContent(
  clientX: number,
  clientY: number,
  root: ParentNode = document,
  viewport: { width: number; height: number } = {
    width: window.innerWidth,
    height: window.innerHeight,
  },
): boolean {
  if (
    clientX < 0 ||
    clientY < 0 ||
    clientX > viewport.width ||
    clientY > viewport.height
  ) {
    return false;
  }

  const samples: SkinWindowHitSample[] = [];
  for (const el of root.querySelectorAll(SKIN_WINDOW_HIT_QUERY)) {
    const kind =
      (el.getAttribute(SKIN_WINDOW_HIT_ATTR) as SkinWindowHitKind | null) ??
      "control";
    const rect = clientRect(el);
    if (!rectContains(rect, clientX, clientY)) continue;
    if (kind === "group") {
      samples.push({ kind, rect, paints: groupBoundsPaints(el) });
      continue;
    }
    if (kind === "artwork") {
      samples.push({
        kind,
        rect,
        opaque: artworkOpaqueInBounds(el, clientX, clientY),
      });
      continue;
    }
    samples.push({ kind: "control", rect });
  }
  return isPointOverSkinWindowHit(clientX, clientY, samples);
}
