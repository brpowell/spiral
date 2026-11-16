import { memo } from "react";
import {
  GLYPH_VIEWBOX,
  RING_LABEL_RADIUS,
  popularityGlyph,
} from "@/lib/popularity/popularityGlyph";
import "./PopularityGlyph.css";

interface PopularityGlyphProps {
  /** 0..1, see `popularityFraction`. */
  fraction: number;
}

/** A track's popularity drawn as concentric grooves. Decorative; label the parent. */
export const PopularityGlyph = memo(function PopularityGlyph({
  fraction,
}: PopularityGlyphProps) {
  const center = GLYPH_VIEWBOX / 2;
  const { rings, labelLit } = popularityGlyph(fraction);
  return (
    <svg
      className="popularity-glyph"
      viewBox={`0 0 ${GLYPH_VIEWBOX} ${GLYPH_VIEWBOX}`}
      aria-hidden
    >
      {rings.map((ring) => (
        <circle
          key={ring.radius}
          className={
            ring.lit
              ? "popularity-glyph__ring popularity-glyph__ring--lit"
              : "popularity-glyph__ring"
          }
          cx={center}
          cy={center}
          r={ring.radius}
        />
      ))}
      <circle
        className="popularity-glyph__label"
        data-lit={labelLit ? "" : undefined}
        cx={center}
        cy={center}
        r={RING_LABEL_RADIUS}
      />
    </svg>
  );
});
