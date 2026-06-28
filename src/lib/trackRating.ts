/**
 * Visual-agnostic rating math: canonical storage (0–255) ↔ discrete UI buckets.
 *
 * Buckets and canonical values are the source of truth. Rendering (stars, tomatoes,
 * thumbs, etc.) lives in `TrackRating` and related UI — not here.
 */

/** Canonical 0–255 rating stored in the database; 0 means unrated. */
export type CanonicalRating = number;

export const UNRATED: CanonicalRating = 0;
export const MAX_CANONICAL_RATING = 255;
export const DEFAULT_BUCKET_COUNT = 10;

/**
 * Max value on the default built-in rating glyph row (5 icons × 2 hit zones).
 * Used only by optional display helpers; not intrinsic to the rating model.
 */
export const DEFAULT_DISPLAY_SCALE_MAX = 5;

/** Canonical values for buckets 1–10 at `DEFAULT_BUCKET_COUNT`. */
export const DEFAULT_BUCKET_CANONICALS: readonly number[] = [
  26, 51, 77, 102, 128, 153, 179, 204, 230, 255,
];

export function isUnrated(canonical: CanonicalRating): boolean {
  return canonical === UNRATED;
}

export function clampCanonical(canonical: CanonicalRating): CanonicalRating {
  if (canonical <= UNRATED) return UNRATED;
  if (canonical >= MAX_CANONICAL_RATING) return MAX_CANONICAL_RATING;
  return canonical;
}

/** Map a canonical rating to a UI bucket (0 = unrated, 1..bucketCount = rated). */
export function canonicalToBucket(
  canonical: CanonicalRating,
  bucketCount: number = DEFAULT_BUCKET_COUNT,
): number {
  if (isUnrated(canonical) || bucketCount <= 0) return 0;
  return Math.round((canonical / MAX_CANONICAL_RATING) * bucketCount);
}

/** Map a UI bucket to a canonical rating (0 = unrated). */
export function bucketToCanonical(
  bucket: number,
  bucketCount: number = DEFAULT_BUCKET_COUNT,
): CanonicalRating {
  if (bucket <= 0 || bucketCount <= 0) return UNRATED;
  return Math.round((bucket / bucketCount) * MAX_CANONICAL_RATING);
}

/** Normalized rating in 0–1 (0 = unrated). */
export function bucketToFraction(
  bucket: number,
  bucketCount: number = DEFAULT_BUCKET_COUNT,
): number {
  if (bucket <= 0 || bucketCount <= 0) return 0;
  return bucket / bucketCount;
}

export function canonicalToFraction(
  canonical: CanonicalRating,
  bucketCount: number = DEFAULT_BUCKET_COUNT,
): number {
  return bucketToFraction(canonicalToBucket(canonical, bucketCount), bucketCount);
}

/**
 * Map a bucket to a value on an arbitrary display scale (e.g. 0–5 for the default
 * glyph row). Rendering chooses the scale and glyphs; this is for text/sort labels.
 */
export function bucketToDisplayValue(
  bucket: number,
  bucketCount: number = DEFAULT_BUCKET_COUNT,
  scaleMax: number = DEFAULT_DISPLAY_SCALE_MAX,
): number {
  if (bucket <= 0 || bucketCount <= 0 || scaleMax <= 0) return 0;
  return bucket * (scaleMax / bucketCount);
}

export function canonicalToDisplayValue(
  canonical: CanonicalRating,
  bucketCount: number = DEFAULT_BUCKET_COUNT,
  scaleMax: number = DEFAULT_DISPLAY_SCALE_MAX,
): number {
  return bucketToDisplayValue(
    canonicalToBucket(canonical, bucketCount),
    bucketCount,
    scaleMax,
  );
}

/** Human-readable label on a display scale, e.g. "3.5" or "—" when unrated. */
export function formatRatingValue(
  canonical: CanonicalRating,
  bucketCount: number = DEFAULT_BUCKET_COUNT,
  scaleMax: number = DEFAULT_DISPLAY_SCALE_MAX,
): string {
  const value = canonicalToDisplayValue(canonical, bucketCount, scaleMax);
  if (value === 0) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
