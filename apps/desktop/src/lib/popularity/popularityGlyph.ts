/**
 * Geometry for the popularity glyph: concentric grooves, like a record. It draws into a 24 x 24
 * viewBox from a 0..1 fraction (see `popularityFraction`), and stays pure so the shape can be
 * tested without a DOM.
 */

export const GLYPH_VIEWBOX = 24;

export const RING_COUNT = 5;
const RING_OUTER_RADIUS = 11.2;
const RING_STEP = 2;
/** Small, like a spindle hole: a big label would crowd out the innermost groove. */
export const RING_LABEL_RADIUS = 1.5;

export interface Ring {
  radius: number;
  lit: boolean;
}

export interface PopularityGlyphShape {
  /** Outermost first. */
  rings: Ring[];
  /** The center label, lit once every groove is. */
  labelLit: boolean;
}

/**
 * Concentric grooves lit from the outside in, like a record being played through to the label. A
 * listened-to track lights at least the outermost groove.
 */
export function popularityGlyph(fraction: number): PopularityGlyphShape {
  const f = Math.min(1, Math.max(0, fraction));
  const lit = f > 0 ? Math.max(1, Math.round(f * RING_COUNT)) : 0;
  return {
    rings: Array.from({ length: RING_COUNT }, (_, i) => ({
      radius: RING_OUTER_RADIUS - i * RING_STEP,
      lit: i < lit,
    })),
    labelLit: lit === RING_COUNT,
  };
}
