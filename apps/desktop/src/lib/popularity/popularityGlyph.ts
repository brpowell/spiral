/**
 * Geometry for the popularity glyphs. Both draw into a 24 x 24 viewBox from a 0..1 fraction (see
 * `popularityFraction`), and stay pure so the shapes can be tested without a DOM.
 */

export const GLYPH_VIEWBOX = 24;
const CENTER = GLYPH_VIEWBOX / 2;

function spiralPoints(
  innerRadius: number,
  outerRadius: number,
  turns: number,
  sweep: number,
): string {
  const total = turns * 2 * Math.PI;
  const points: string[] = [];
  for (let t = 0; t <= sweep + 1e-6; t += 0.12) {
    const r = innerRadius + (outerRadius - innerRadius) * (t / total);
    // Start at twelve o'clock and wind clockwise.
    const x = CENTER + r * Math.cos(t - Math.PI / 2);
    const y = CENTER + r * Math.sin(t - Math.PI / 2);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

const WIND_UP_TURNS = 2.25;
/** A listened-to track always shows at least a short curl. */
const WIND_UP_MIN_SWEEP = 0.5;

export interface WindUpGlyph {
  /** The full spiral, drawn faintly behind. */
  track: string;
  /** The wound-up part. `null` when nothing has been played. */
  lit: string | null;
}

/** A spiral that winds outward from the center as the fraction grows. */
export function windUpGlyph(fraction: number): WindUpGlyph {
  const total = WIND_UP_TURNS * 2 * Math.PI;
  const f = Math.min(1, Math.max(0, fraction));
  return {
    track: spiralPoints(1.5, 10, WIND_UP_TURNS, total),
    lit:
      f > 0
        ? spiralPoints(
            1.5,
            10,
            WIND_UP_TURNS,
            Math.max(WIND_UP_MIN_SWEEP, f * total),
          )
        : null,
  };
}

export const RING_COUNT = 5;
const RING_OUTER_RADIUS = 11.2;
const RING_STEP = 2;
/** Small, like a spindle hole: a big label would crowd out the innermost groove. */
export const RING_LABEL_RADIUS = 1.5;

export interface Ring {
  radius: number;
  lit: boolean;
}

export interface RingsGlyph {
  /** Outermost first. */
  rings: Ring[];
  /** The center label, lit once every groove is. */
  labelLit: boolean;
}

/**
 * Concentric grooves lit from the outside in, like a record being played through to the label. A
 * listened-to track lights at least the outermost groove.
 */
export function ringsGlyph(fraction: number): RingsGlyph {
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
