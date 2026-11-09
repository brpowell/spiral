/** Normalized region of a source image (0–1 of natural width/height). */
export type ImageCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImageCropFrameStyle = {
  width: string;
  height: string;
  left: string;
  top: string;
};

export const IMAGE_CROP_MIN_ZOOM = 1;
export const IMAGE_CROP_MAX_ZOOM = 4;

const EPS = 1e-9;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Largest cover rect (object-fit: cover) for `aspect` (frame width/height) at zoom 1. */
export function coverCrop(
  naturalWidth: number,
  naturalHeight: number,
  aspect = 1,
): ImageCrop {
  if (naturalWidth <= 0 || naturalHeight <= 0 || aspect <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const imageAspect = naturalWidth / naturalHeight;
  let width: number;
  let height: number;
  if (imageAspect > aspect) {
    // Image wider than frame — height fills, width is a fraction.
    height = 1;
    width = (aspect * naturalHeight) / naturalWidth;
  } else {
    // Image taller or equal — width fills, height is a fraction.
    width = 1;
    height = naturalWidth / (aspect * naturalHeight);
  }

  return {
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height,
  };
}

export function clampCrop(crop: ImageCrop): ImageCrop {
  const width = clamp(crop.width, EPS, 1);
  const height = clamp(crop.height, EPS, 1);
  return {
    x: clamp(crop.x, 0, 1 - width),
    y: clamp(crop.y, 0, 1 - height),
    width,
    height,
  };
}

/** Zoom relative to the cover crop (1 = cover, higher = tighter). */
export function zoomFromCrop(
  crop: ImageCrop,
  naturalWidth: number,
  naturalHeight: number,
  aspect = 1,
): number {
  const cover = coverCrop(naturalWidth, naturalHeight, aspect);
  if (crop.width <= 0 || cover.width <= 0) return IMAGE_CROP_MIN_ZOOM;
  return clamp(
    cover.width / crop.width,
    IMAGE_CROP_MIN_ZOOM,
    IMAGE_CROP_MAX_ZOOM,
  );
}

export function cropAtZoom(
  naturalWidth: number,
  naturalHeight: number,
  zoom: number,
  centerX: number,
  centerY: number,
  aspect = 1,
): ImageCrop {
  const cover = coverCrop(naturalWidth, naturalHeight, aspect);
  const z = clamp(zoom, IMAGE_CROP_MIN_ZOOM, IMAGE_CROP_MAX_ZOOM);
  const width = cover.width / z;
  const height = cover.height / z;
  return clampCrop({
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  });
}

function cropCenter(crop: ImageCrop): { x: number; y: number } {
  return {
    x: crop.x + crop.width / 2,
    y: crop.y + crop.height / 2,
  };
}

/**
 * CSS placement of the source image inside a square/rect frame so the visible
 * region matches `crop`. Frame size is 100% of the containing box.
 */
export function cropToFrameStyle(crop: ImageCrop): ImageCropFrameStyle {
  const safe = clampCrop(crop);
  const widthPct = 100 / safe.width;
  const heightPct = 100 / safe.height;
  return {
    width: `${widthPct}%`,
    height: `${heightPct}%`,
    left: `${-safe.x * widthPct}%`,
    top: `${-safe.y * heightPct}%`,
  };
}

/** Pan by a delta in frame-normalized units (1 = one frame width/height). */
export function panCrop(
  crop: ImageCrop,
  deltaFrameX: number,
  deltaFrameY: number,
): ImageCrop {
  return clampCrop({
    ...crop,
    x: crop.x - deltaFrameX * crop.width,
    y: crop.y - deltaFrameY * crop.height,
  });
}

export function zoomCrop(
  crop: ImageCrop,
  naturalWidth: number,
  naturalHeight: number,
  nextZoom: number,
  aspect = 1,
): ImageCrop {
  const center = cropCenter(crop);
  return cropAtZoom(
    naturalWidth,
    naturalHeight,
    nextZoom,
    center.x,
    center.y,
    aspect,
  );
}

export function cropsEqual(
  a: ImageCrop | null | undefined,
  b: ImageCrop | null | undefined,
  epsilon = 1e-6,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}

/** Longest edge the backend will write; larger sources are scaled down to this. */
export const IMAGE_OUTPUT_MAX_EDGE = 2000;
const IMAGE_OUTPUT_PRESETS = [1500, 1000, 600];

export type ImageOutputSize = {
  /** Longest-edge cap to send to the backend; null means the full size. */
  maxEdge: number | null;
  width: number;
  height: number;
};

/** Pixel size of the cropped region once capped at `maxEdge` (never upscaled). */
export function imageOutputSize(
  naturalWidth: number,
  naturalHeight: number,
  crop: ImageCrop,
  maxEdge: number | null,
): ImageOutputSize {
  const width = Math.max(1, crop.width * naturalWidth);
  const height = Math.max(1, crop.height * naturalHeight);
  const cap = Math.min(maxEdge ?? IMAGE_OUTPUT_MAX_EDGE, IMAGE_OUTPUT_MAX_EDGE);
  const scale = Math.min(1, cap / Math.max(width, height));
  return {
    maxEdge,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Full size first, then each preset that would actually shrink the result. */
export function imageOutputSizeOptions(
  naturalWidth: number,
  naturalHeight: number,
  crop: ImageCrop,
): ImageOutputSize[] {
  const full = imageOutputSize(naturalWidth, naturalHeight, crop, null);
  const fullEdge = Math.max(full.width, full.height);
  return [
    full,
    ...IMAGE_OUTPUT_PRESETS.filter((edge) => edge < fullEdge).map((edge) =>
      imageOutputSize(naturalWidth, naturalHeight, crop, edge),
    ),
  ];
}
